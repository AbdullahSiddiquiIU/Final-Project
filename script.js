// Global constants for chart dimensions and margins
const margin = { top: 50, right: 50, bottom: 50, left: 60 };
const width = 900 - margin.left - margin.right;
const height = 500 - margin.top - margin.bottom;

// Function to display error messages
function showError(message) {
  console.error(message);
  d3.select("#error-message").html(`<p class="error-message"><strong>Error:</strong> ${message}</p>`);
}

// Function to parse and clean data rows
function parseDataRow(d, index) {
  const temperature = parseFloat(d["Temperature (C)"]);
  const apparentTemperature = parseFloat(d["Apparent Temperature (C)"]);
  const humidity = parseFloat(d["Humidity"]);
  // Example date format: "2006-04-01 00:00:00.000 +0200" -> needs robust parsing
  // Let's try parsing and handle potential errors
  let date = null;
  try {
      // Attempt to parse common formats, remove timezone for simplicity here if needed
      const dateString = d["Formatted Date"].substring(0, 19); // Take YYYY-MM-DD HH:MM:SS part
      date = new Date(dateString);
      if (isNaN(date.getTime())) { // Check if date is valid
          date = null; // Invalid date parsed
          // console.warn(`Invalid date format in row ${index}:`, d["Formatted Date"]);
      }
  } catch (e) {
      // console.warn(`Error parsing date in row ${index}:`, d["Formatted Date"], e);
      date = null;
  }


  // Return parsed object only if date and primary temperature are valid
  if (date && !isNaN(temperature)) {
    return {
      date: date,
      temperature: temperature,
      // Use NaN for optional fields if they are invalid, handle downstream
      apparentTemperature: !isNaN(apparentTemperature) ? apparentTemperature : NaN,
      humidity: !isNaN(humidity) ? humidity : NaN,
      originalIndex: index // Keep track of original row for debugging if needed
    };
  } else {
      // Log issues less intrusively - uncomment for deep debugging
      // if (!date) console.warn(`Skipping row ${index} due to invalid date:`, d["Formatted Date"]);
      // if (isNaN(temperature)) console.warn(`Skipping row ${index} due to invalid temperature:`, d["Temperature (C)"]);
      return null; // Indicate row is invalid
  }
}

// Function to aggregate data by day
function aggregateDailyData(data) {
    // Filter out nulls from parsing errors first
    const validParsedData = data.filter(d => d !== null);

    // Group data by day (use YYYY-MM-DD as the key)
    const groupedByDay = d3.group(validParsedData, d => d.date.toISOString().split('T')[0]);

    // Calculate daily averages, ensuring NaNs are handled in means
    const aggregatedData = Array.from(groupedByDay, ([dateStr, values]) => {
        const avgTemp = d3.mean(values, d => d.temperature);
        // Filter out NaNs before calculating mean for optional fields
        const avgApparentTemp = d3.mean(values.filter(d => !isNaN(d.apparentTemperature)), d => d.apparentTemperature);
        const avgHumidity = d3.mean(values.filter(d => !isNaN(d.humidity)), d => d.humidity);

        return {
            date: new Date(dateStr + 'T00:00:00Z'), // Use UTC midnight for consistency
            temperature: avgTemp,
            apparentTemperature: isNaN(avgApparentTemp) ? null : avgApparentTemp, // Store null if no valid data
            humidity: isNaN(avgHumidity) ? null : avgHumidity, // Store null if no valid data
            count: values.length // Number of hourly points aggregated
        };
    }).filter(d => !isNaN(d.temperature)) // Only keep days with a valid average temperature
      .sort((a, b) => a.date - b.date); // Sort chronologically

    console.log(`Aggregated ${validParsedData.length} valid hourly points into ${aggregatedData.length} daily averages.`);
    return aggregatedData;
}


// Function to create the interactive line chart
function createLineChart(aggregatedData) {
    // Clear previous chart/error messages
    d3.select("#chart").html("");
    d3.select("#error-message").html("");

    if (!aggregatedData || aggregatedData.length === 0) {
        showError("No valid aggregated data to visualize.");
        return;
    }

    // Create SVG container
    const svg = d3.select("#chart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- Scales ---
    const x = d3.scaleTime()
        .domain(d3.extent(aggregatedData, d => d.date))
        .range([0, width]);

    // Calculate y-domain considering both temp and apparent temp, handling potential nulls
    const yMin = d3.min(aggregatedData, d => Math.min(d.temperature, d.apparentTemperature ?? d.temperature));
    const yMax = d3.max(aggregatedData, d => Math.max(d.temperature, d.apparentTemperature ?? d.temperature));

    const y = d3.scaleLinear()
        .domain([yMin - 2, yMax + 2]).nice() // Add padding and make nice
        .range([height, 0]);

    // --- Axes ---
    const xAxisGroup = svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat("%Y"))); // Tick per year

    const yAxisGroup = svg.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(y));

    // Add Y Axis Label
    yAxisGroup.append("text")
       .attr("class", "axis-label")
       .attr("transform", "rotate(-90)")
       .attr("y", -margin.left + 15) // Position left of axis
       .attr("x", -(height / 2))
       .attr("text-anchor", "middle")
       .text("Daily Average Temperature (°C)");

    // Add X Axis Label
    xAxisGroup.append("text")
        .attr("class", "axis-label")
        .attr("y", margin.bottom - 10) // Position below axis
        .attr("x", width / 2)
        .attr("text-anchor", "middle")
        .text("Year");

    // --- Line Generators ---
    // Need to handle nulls in apparent temperature data
    const lineGeneratorTemp = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.temperature));

    const lineGeneratorApparent = d3.line()
        .defined(d => d.apparentTemperature !== null) // Only draw segments with valid data
        .x(d => x(d.date))
        .y(d => y(d.apparentTemperature));

    // --- Draw Lines ---
    // Clipping path to prevent lines going outside chart area during zoom
    svg.append("defs").append("clipPath")
       .attr("id", "clip")
       .append("rect")
       .attr("width", width)
       .attr("height", height);

    const chartArea = svg.append("g")
       .attr("clip-path", "url(#clip)"); // Apply clipping path

    const tempLinePath = chartArea.append("path")
        .datum(aggregatedData)
        .attr("class", "line temp-line")
        .attr("fill", "none")
        .attr("stroke", "steelblue")
        .attr("stroke-width", 1.5)
        .attr("d", lineGeneratorTemp);

    const apparentLinePath = chartArea.append("path")
        .datum(aggregatedData)
        .attr("class", "line apparent-line")
        .attr("fill", "none")
        .attr("stroke", "orange")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "5,5") // Dashed line
        .attr("d", lineGeneratorApparent);

    // --- Legend ---
    const legend = svg.append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${width - 180}, ${-margin.top + 20})`); // Position top-right

    legend.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 20).attr("y2", 0)
        .attr("stroke", "steelblue").attr("stroke-width", 2);
    legend.append("text").attr("x", 25).attr("y", 5).text("Avg Temperature").style("font-size", "12px");

    legend.append("line").attr("x1", 0).attr("y1", 20).attr("x2", 20).attr("y2", 20)
        .attr("stroke", "orange").attr("stroke-width", 2).attr("stroke-dasharray", "5,5");
    legend.append("text").attr("x", 25).attr("y", 25).text("Avg Apparent Temp").style("font-size", "12px");

    // --- Tooltip ---
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip"); // Style is in CSS

    // --- Focus Elements (for tooltip interaction) ---
    const focus = svg.append("g")
        .attr("class", "focus")
        .style("display", "none"); // Hidden initially

    focus.append("line") // Vertical line
        .attr("class", "focus-line")
        .attr("y1", 0)
        .attr("y2", height);

    focus.append("circle") // Circle for actual temp
        .attr("class", "focus-circle")
        .attr("r", 4.5)
        .attr("stroke", "steelblue");

    focus.append("circle") // Circle for apparent temp
        .attr("class", "focus-circle")
        .attr("r", 4.5)
        .attr("stroke", "orange");

    // --- Zoom ---
    const zoom = d3.zoom()
        .scaleExtent([1, 30]) // Zoom limits
        .translateExtent([[0, 0], [width, height]]) // Pan limits
        .extent([[0, 0], [width, height]])
        .on("zoom", handleZoom);

    // Invisible rectangle for zoom/tooltip events
    const zoomRect = svg.append("rect")
        .attr("class", "zoom-rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .style("cursor", "crosshair") // Use crosshair for hover/tooltip indication
        .call(zoom) // Attach zoom behavior
        .on("mouseover", () => {
            focus.style("display", null);
            tooltip.style("opacity", 1); // Make tooltip visible
        })
        .on("mouseout", () => {
            focus.style("display", "none");
            tooltip.style("opacity", 0); // Hide tooltip
        })
        .on("mousemove", handleMouseMove);


    // Bisector function to find closest date index
    const bisectDate = d3.bisector(d => d.date).left;

    // Zoom handler function
    function handleZoom(event) {
        const transform = event.transform;
        const newXScale = transform.rescaleX(x); // Create new scale based on zoom

        // Update X axis
        xAxisGroup.call(d3.axisBottom(newXScale).ticks(d3.timeYear.every(1)).tickFormat(d3.timeFormat("%Y")));

        // Update line paths using the new scale
        tempLinePath.attr("d", lineGeneratorTemp.x(d => newXScale(d.date)));
        apparentLinePath.attr("d", lineGeneratorApparent.x(d => newXScale(d.date)));

        // Hide focus/tooltip during zoom interaction
        focus.style("display", "none");
        tooltip.style("opacity", 0);
    }

    // Mouse move handler function (for tooltip)
    function handleMouseMove(event) {
        const currentTransform = d3.zoomTransform(this); // Get current zoom state
        const pointer = d3.pointer(event, this); // Mouse position relative to zoomRect
        const xDate = currentTransform.rescaleX(x).invert(pointer[0]); // Map mouse X to date using current scale

        const i = bisectDate(aggregatedData, xDate, 1); // Find index of data point to the right
        if (i <= 0 || i >= aggregatedData.length) return; // Avoid errors at edges

        const d0 = aggregatedData[i - 1];
        const d1 = aggregatedData[i];
        // Find the data point closest to the mouse date
        const d = (xDate - d0.date > d1.date - xDate) ? d1 : d0;

        if (!d) return;

        // Calculate positions using the *current* effective scale
        const focusX = currentTransform.applyX(x(d.date));
        const focusYTemp = y(d.temperature); // Y position based on original scale
        const focusYApparent = (d.apparentTemperature !== null) ? y(d.apparentTemperature) : null;

        // Check if calculated X position is within the visible chart width
        if (focusX < 0 || focusX > width) {
            focus.style("display", "none");
            tooltip.style("opacity", 0);
            return; // Hide if outside bounds
        }
         focus.style("display", null); // Ensure visible if within bounds

        // Move focus elements
        focus.select(".focus-line").attr("x1", focusX).attr("x2", focusX);
        focus.selectAll(".focus-circle") // Select both circles
            .filter((_, circleIndex) => circleIndex === 0) // First circle (temp)
            .attr("cx", focusX)
            .attr("cy", focusYTemp);

        focus.selectAll(".focus-circle")
            .filter((_, circleIndex) => circleIndex === 1) // Second circle (apparent)
            .attr("cx", focusX)
            .attr("cy", focusYApparent)
            .style("display", focusYApparent === null ? "none" : null); // Hide if apparent temp is null

        // Update tooltip content
        let tooltipHtml = `
            <strong>${d.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</strong><br>
            <span style="color: steelblue;">Avg Temp:</span> ${d.temperature.toFixed(1)}°C<br>`;

        if (d.apparentTemperature !== null) {
           tooltipHtml += `<span style="color: orange;">Avg Apparent:</span> ${d.apparentTemperature.toFixed(1)}°C<br>`;
        }
        if (d.humidity !== null) {
            tooltipHtml += `Avg Humidity: ${(d.humidity * 100).toFixed(0)}%`;
        }

        tooltip.html(tooltipHtml)
               .style("left", (event.pageX + 15) + "px") // Position tooltip relative to mouse cursor
               .style("top", (event.pageY - 20) + "px")
               .style("opacity", 1); // Ensure it's visible
    }

     // Allow resetting zoom by double-clicking
     zoomRect.on("dblclick.zoom", () => {
        svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity // Reset to original transform
        );
    });

    // Add chart title (could also be done in HTML)
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", -margin.top / 2 - 5) // Adjust position above chart
        .attr("text-anchor", "middle")
        .style("font-size", "18px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        // .text("Daily Average Temperature vs. Apparent Temperature (2006-2016)"); // Title already in HTML h1
}


// --- Main Data Loading Logic ---
d3.csv("data.csv", parseDataRow) // Use row parsing function directly
  .then(parsedData => {
    // Aggregate the valid parsed data
    const aggregatedData = aggregateDailyData(parsedData);

    if (aggregatedData && aggregatedData.length > 0) {
      createLineChart(aggregatedData);
    } else {
      showError("No valid data available after parsing and aggregation. Check CSV format and content.");
    }
  })
  .catch(error => {
    showError(`Failed to load or process data.csv: ${error.message}`);
  });