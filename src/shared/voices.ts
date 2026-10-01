// The voices offered when picking how Buddy speaks. Each id is an ElevenLabs
// voice on Buddy's account. The play button uses that voice's free preview,
// not a generated line.

export interface Voice {
  id: string;
  name: string;
}

export const VOICES: readonly Voice[] = [
  { id: "s3TPKV1kjDlVtZbl4Ksh", name: "Adam" },
  { id: "nf4MCGNSdM0hxM95ZBQR", name: "Eve" },
  { id: "vBKc2FfBKJfcZNyEt1n6", name: "Finn" },
  { id: "lcMyyd2HUfFzxdCaC4Ta", name: "Lucy" },
  { id: "DTKMou8ccj1ZaWGBiotd", name: "Jamahal" },
  { id: "M7ya1YbaeFaPXljg9BpK", name: "Hannah" },
  { id: "EOVAuWqgSZN2Oel78Psj", name: "George" },
  { id: "EST9Ui6982FZPSi7gCHi", name: "Elise" },
  { id: "uYXf8XasLslADfZ2MB4u", name: "Hope" },
  { id: "6aDn1KB0hjpdcocrUkmq", name: "Tiffany" },
  { id: "rBkiq5ZQ43ogwd6i4uIQ", name: "Peanut" },
  { id: "qXpMhyvQqiRxWQs4qSSB", name: "Horatius" },
  { id: "XsmrVB66q3D4TaXVaWNF", name: "Marshal" },
  { id: "wDsJlOXPqcvIUKdLXjDs", name: "Jarvis" },
  { id: "oR4uRy4fHDUGGISL0Rev", name: "Merlin" },
];

/** Spoken until someone picks: Adam. */
export const DEFAULT_VOICE_ID = "s3TPKV1kjDlVtZbl4Ksh";
