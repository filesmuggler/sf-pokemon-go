/**
 * Map features the agent can ask players to verify, with the OpenStreetMap
 * tags that define them and the 311 categories they tend to explain.
 * Observations are stored with these tags so the collected data can later be
 * reviewed and (manually) contributed upstream.
 */
export interface OsmFeatureDef {
  label: string;
  /** Primary OSM tag, e.g. { amenity: "waste_basket" }. */
  tags: Record<string, string>;
  /** 311 categories where "is there a <feature> here?" is a useful question. */
  related_311: string[];
}

export const OSM_FEATURES = {
  waste_basket: {
    label: "public trash can",
    tags: { amenity: "waste_basket" },
    related_311: ["Street and Sidewalk Cleaning", "Litter Receptacles"],
  },
  recycling: {
    label: "recycling container",
    tags: { amenity: "recycling" },
    related_311: ["Street and Sidewalk Cleaning"],
  },
  street_lamp: {
    label: "street lamp",
    tags: { highway: "street_lamp" },
    related_311: ["Streetlights", "Street Lights"],
  },
  bench: {
    label: "public bench",
    tags: { amenity: "bench" },
    related_311: ["Street and Sidewalk Cleaning", "Encampments"],
  },
  bicycle_parking: {
    label: "bike rack",
    tags: { amenity: "bicycle_parking" },
    related_311: ["Blocked Street or Sidewalk", "Abandoned Vehicle"],
  },
  tree: {
    label: "street tree",
    tags: { natural: "tree" },
    related_311: ["Tree Maintenance"],
  },
  crossing: {
    label: "pedestrian crossing",
    tags: { highway: "crossing" },
    related_311: ["Sidewalk or Curb", "Street Defects", "Parking & Traffic Sign Repair"],
  },
  drinking_water: {
    label: "drinking fountain",
    tags: { amenity: "drinking_water" },
    related_311: ["Street and Sidewalk Cleaning"],
  },
  toilets: {
    label: "public toilet",
    tags: { amenity: "toilets" },
    related_311: ["Street and Sidewalk Cleaning", "Human or Animal Waste"],
  },
  fire_hydrant: {
    label: "fire hydrant",
    tags: { emergency: "fire_hydrant" },
    related_311: ["Water", "Street Defects"],
  },
  bus_stop: {
    label: "transit stop",
    tags: { highway: "bus_stop" },
    related_311: ["MUNI Feedback", "Street and Sidewalk Cleaning"],
  },
  traffic_sign: {
    label: "traffic / parking sign",
    tags: { "traffic_sign": "*" },
    related_311: ["Parking & Traffic Sign Repair", "Sign Repair"],
  },
  manhole: {
    label: "manhole / drain cover",
    tags: { man_made: "manhole" },
    related_311: ["Sewer Issues", "Street Defects"],
  },
  artwork: {
    label: "mural / public art",
    tags: { tourism: "artwork" },
    related_311: ["Graffiti"],
  },
} as const satisfies Record<string, OsmFeatureDef>;

export const OSM_FEATURE_KEYS = Object.keys(OSM_FEATURES) as [keyof typeof OSM_FEATURES, ...(keyof typeof OSM_FEATURES)[]];
export type OsmFeatureKeyName = keyof typeof OSM_FEATURES;

export function isOsmFeatureKey(v: string): v is OsmFeatureKeyName {
  return v in OSM_FEATURES;
}

/** "amenity=waste_basket" style strings for a feature. */
export function featureTagStrings(key: OsmFeatureKeyName): string[] {
  return Object.entries(OSM_FEATURES[key].tags).map(([k, v]) => `${k}=${v}`);
}

/** Overpass tag filter, e.g. `[amenity=waste_basket]` or `[traffic_sign]`. */
export function overpassFilter(key: OsmFeatureKeyName): string {
  return Object.entries(OSM_FEATURES[key].tags)
    .map(([k, v]) => (v === "*" ? `["${k}"]` : `["${k}"="${v}"]`))
    .join("");
}

/** Which features are worth checking for a given 311 category. */
export function featuresFor311Category(category: string): OsmFeatureKeyName[] {
  const c = category.toLowerCase();
  return OSM_FEATURE_KEYS.filter((k) => OSM_FEATURES[k].related_311.some((r) => c.includes(r.toLowerCase()) || r.toLowerCase().includes(c)));
}
