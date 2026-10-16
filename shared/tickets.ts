export type TicketServiceStatus = {
  name: string;
  state: "starting" | "ready" | "error" | "disabled";
  message: string;
  lastQuery?: { at: string; ok: boolean; count: number; error?: string };
};
export type TicketOption = {
  name: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  price: number | null;
  currency: "CNY";
  priceBasis: "per_person" | "all_passengers";
  availability: string;
  [key: string]: unknown;
};
export type TicketData = {
  origin: string;
  destination: string;
  date: string;
  passengers: number;
  results: TicketOption[];
  count: number;
  queriedAt: string;
  note: string;
  urls: string[];
  warnings?: string[];
};
