/** Public GET /api/checkin/lookup payload. Returning guests need every key. */
export const CHECKIN_LOOKUP_DATA_KEYS = [
  "name",
  "contactNumber",
  "comingFrom",
  "nationality",
  "emergencyName",
  "emergencyPhone",
  "idType",
  "idCardLink",
  "visaLink",
  "formCData",
  "idReuseAttestation",
  "visaReuseAttestation",
] as const;

export type CheckinLookupRecord = {
  name: string;
  contact: string;
  comingFrom?: string | null;
  nationality?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  idType?: string | null;
  idCardLink?: string | null;
  visaLink?: string | null;
  formCData?: string | null;
  verified?: string | null;
};

export async function checkinLookupData(record: CheckinLookupRecord) {
  const { issueCheckinReuseAttestation } = await import("@/lib/checkinReuseAttestation");
  const name = record.name;
  const contact = record.contact;
  const nationality = record.nationality || "India";
  const idType = record.idType || "";
  const idCardLink = record.idCardLink || "";
  const visaLink = record.visaLink || "";
  return {
    name,
    contactNumber: record.contact,
    comingFrom: record.comingFrom || "",
    nationality,
    emergencyName: record.emergencyName || "",
    emergencyPhone: record.emergencyPhone || "",
    idType,
    idCardLink,
    visaLink,
    formCData: record.formCData || "",
    idReuseAttestation: await issueCheckinReuseAttestation({ category: "id", name, contact, nationality, idType, links: idCardLink, verified: record.verified || "" }),
    visaReuseAttestation: await issueCheckinReuseAttestation({ category: "visa", name, contact, nationality, idType, links: visaLink, verified: record.verified || "" }),
  };
}
