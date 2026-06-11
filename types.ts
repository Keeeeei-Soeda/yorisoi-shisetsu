export interface Medication {
  name: string;
  dose: string;
  route: string;
  frequency: string;
  status: string;
  reason_or_note: string;
}

export interface PharmacyFocus {
  medications: Medication[];
  adherence: string;
  side_effects: string[];
  drug_related_problems: string[];
  labs_and_monitoring: string[];
  patient_education: string[];
  follow_up: string;
}

export interface Soap {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface Alerts {
  red_flags: string[];
  need_to_contact_physician: string[];
}

export interface Meta {
  main_problems: string[];
  note_for_pharmacy: string;
}

export interface ClinicalData {
  soap: Soap;
  pharmacy_focus: PharmacyFocus;
  alerts: Alerts;
  meta: Meta;
}

export interface Record {
  id: string;
  date: string;
  transcript: string;
  clinicalData: ClinicalData;
  status: 'approved' | 'pending';
}

export interface Patient {
  id: string;
  name: string;
  kana: string;
  birthDate: string; // YYYY-MM-DD
  age: number;
  gender: 'male' | 'female';
  avatarColor: string;
  records: Record[];
}

export type VisitType = 'facility' | 'home';

export interface RosterPatient {
  id: string;
  name: string;
  kana: string;
  room?: string;
  note?: string;
}

export interface Facility {
  id: string;
  name: string;
  type: VisitType;
  address?: string;
  roster: RosterPatient[];
}

export interface RoundSegment {
  id: string;
  order: number;
  predictedName: string;
  transcript: string;
  clinicalData: ClinicalData;
  suggestedPatientId?: string;
}

export interface Round {
  id: string;
  date: string; // YYYY-MM-DD
  timeframe: '午前' | '午後' | '夜間';
  facilityId: string;
  segments: RoundSegment[];
}

export interface QuickSoapRecord {
  id: string;
  facilityId: string | null;
  rosterPatientId: string | null;
  patientNameOverride?: string;
  date: string;
  bulletInput: string;
  soap: ClinicalData['soap'];
  createdAt: string;
  updatedAt: string;
}

export interface QuickSoapFilter {
  facilityId?: string;
  rosterPatientId?: string;
  dateFrom?: string;
  dateTo?: string;
}