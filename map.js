// Import Mapbox as an ESM module
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// Set your Mapbox access token here
mapboxgl.accessToken =
  "pk.eyJ1IjoiY2VjaWxpYS1tYXJpZWEiLCJhIjoiY21od211c29kMDE5aDJxcHhneWo5MG9meSJ9.ufmGcz786YmCCgK2CPd_bw";

// Initialize map
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

/* --------------------------
    HELPERS
---------------------------*/

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const started = minutesSinceMidnight(trip.started_at);
        const ended = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(started - timeFilter) <= 60 ||
          Math.abs(ended - timeFilter) <= 60
        );
      });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

/* -------------------------------
   MAIN EXECUTION
-------------------------------*/

map.on("load", async () => {
  /* --------------------------
      BIKE LANE LAYERS
  ---------------------------*/

  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "blue",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  /* --------------------------
      LOAD STATIONS & TRIPS
  ---------------------------*/

  const stationURL =
    "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  const tripURL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  let jsonData = await d3.json(stationURL);

  let trips = await d3.csv(tripURL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  let stations = computeStationTraffic(jsonData.data.stations, trips);

  /* --------------------------
      SCALES
  ---------------------------*/

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  /* --------------------------
      DRAW CIRCLES (SVG)
  ---------------------------*/

  const svg = d3.select("#map").select("svg");

  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name)
    .enter()
    .append("circle")
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .attr("opacity", 0.8)
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .style("--departure-ratio", (d) =>
      stationFlow(d.departures / d.totalTraffic)
    );

  /* --------------------------
      TOOLTIP FIX (IMPORTANT)
  ---------------------------*/
  circles.each(function (d) {
    d3.select(this)
      .append("title")
      .text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  });

  /* --------------------------
      UPDATE POSITIONS ON MAP MOVE
  ---------------------------*/

  function updatePositions() {
    circles
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);

  /* --------------------------
      SLIDER INTERACTION
  ---------------------------*/

  const timeSlider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = "";
      anyTimeLabel.style.display = "block";
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = "none";
    }

    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr("r", (d) => radiusScale(d.totalTraffic))
      .style("--departure-ratio", (d) =>
        stationFlow(d.departures / d.totalTraffic)
      );
  }

  timeSlider.addEventListener("input", updateTimeDisplay);
  updateTimeDisplay();
});
