export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  modes: string[]; // all transport modes, sorted by priority
}

export async function getNearbyStops(lat: number, lng: number, distance = 1500): Promise<Stop[]> {
  const query = `{
    nearest(
      latitude: ${lat}
      longitude: ${lng}
      maximumDistance: ${distance}
      filterByPlaceTypes: [stopPlace]
      maximumResults: 60
    ) {
      edges {
        node {
          place {
            ... on StopPlace {
              id
              name
              latitude
              longitude
              transportMode
            }
          }
        }
      }
    }
  }`;

  const res = await fetch("https://api.entur.io/journey-planner/v3/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": "ruter-reisetid-poc",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const PRIORITY = ["metro", "rail", "tram", "water", "bus"];

  return (data.data?.nearest?.edges ?? []).map((edge: any) => {
    const raw: string[] = Array.isArray(edge.node.place.transportMode)
      ? edge.node.place.transportMode
      : [edge.node.place.transportMode ?? "bus"];

    // Deduplicate & sort by visual priority (metro first, bus last)
    const modes = [...new Set(raw)].sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    return {
      id: edge.node.place.id,
      name: edge.node.place.name,
      lat: edge.node.place.latitude,
      lng: edge.node.place.longitude,
      modes,
    };
  });
}
