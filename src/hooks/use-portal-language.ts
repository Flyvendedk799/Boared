import { createContext, useContext } from "react";

export type PortalLanguage = "en" | "da";
export const PortalLanguageContext = createContext<PortalLanguage>("en");
export function usePortalText() {
  const language = useContext(PortalLanguageContext);
  return (english: string, danish: string) => (language === "da" ? danish : english);
}

const danishLabels: Record<string, string> = {
  Home: "Hjem",
  "My tickets": "Mine sager",
  Tickets: "Sager",
  Projects: "Projekter",
  Inbox: "Indbakke",
  Settings: "Indstillinger",
  Report: "Indberet",
  More: "Mere",
  Search: "Søg",
  "Awaiting response": "Afventer svar",
  Replies: "Svar",
  Mentions: "Omtaler",
  "Ticket updates": "Sagsopdateringer",
  Invoices: "Fakturaer",
  Assignments: "Tildelinger",
  Feature: "Funktion",
  Change: "Ændring",

  Discovery: "Afklaring",
  Proposal: "Tilbud",
  "In progress": "I gang",
  "In review": "Til gennemgang",
  Done: "Færdig",
  Archived: "Arkiveret",
  Open: "Åben",
  Triaged: "Vurderet",
  "Won't fix": "Løses ikke",
  Comment: "Kommentar",
  Mention: "Omtale",
  "Ticket update": "Sagsopdatering",
  Invoice: "Faktura",
  Meeting: "Møde",
  Milestone: "Milepæl",
  Assigned: "Tildelt",
  Overview: "Oversigt",
  Billing: "Fakturering",
  People: "Personer",
  Meetings: "Møder",
  Milestones: "Milepæle",
  Updates: "Opdateringer",
  Plans: "Planer",
  Low: "Lav",
  Medium: "Mellem",
  High: "Høj",
  Urgent: "Haster",
  Bug: "Fejl",
  Question: "Spørgsmål",
  Feedback: "Feedback",
  "Feature request": "Funktionsønske",
  "Change request": "Ændringsønske",
  Draft: "Kladde",
  Sent: "Sendt",
  Accepted: "Accepteret",
  Declined: "Afslået",
  Paid: "Betalt",
  Overdue: "Forfalden",
  Void: "Annulleret",
  Expired: "Udløbet",
};
export function portalLabel(t: (english: string, danish: string) => string, label: string) {
  return t(label, danishLabels[label] ?? label);
}
