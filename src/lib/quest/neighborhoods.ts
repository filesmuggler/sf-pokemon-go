/** Quick-start centers for SF neighborhoods. Approximate centroids. */
export const SF_NEIGHBORHOODS = [
  { slug: "mission", name: "Mission", lat: 37.7599, lon: -122.4148 },
  { slug: "tenderloin", name: "Tenderloin", lat: 37.7841, lon: -122.4138 },
  { slug: "soma", name: "SoMa", lat: 37.7785, lon: -122.4056 },
  { slug: "castro", name: "Castro", lat: 37.7609, lon: -122.435 },
  { slug: "haight", name: "Haight-Ashbury", lat: 37.7692, lon: -122.4481 },
  { slug: "chinatown", name: "Chinatown", lat: 37.7941, lon: -122.4078 },
  { slug: "north-beach", name: "North Beach", lat: 37.8003, lon: -122.4103 },
  { slug: "richmond", name: "Inner Richmond", lat: 37.7801, lon: -122.4647 },
  { slug: "sunset", name: "Inner Sunset", lat: 37.7604, lon: -122.4694 },
  { slug: "bayview", name: "Bayview", lat: 37.7299, lon: -122.3908 },
  { slug: "excelsior", name: "Excelsior", lat: 37.7246, lon: -122.4262 },
  { slug: "hayes-valley", name: "Hayes Valley", lat: 37.7759, lon: -122.4245 },
] as const;

export type Neighborhood = (typeof SF_NEIGHBORHOODS)[number];
