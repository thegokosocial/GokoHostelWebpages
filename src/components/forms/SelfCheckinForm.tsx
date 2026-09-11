"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useRef, useEffect } from "react";
import { checkinSchema, isForeignNationality, type CheckinFormData, BOOKING_PLATFORMS } from "@/lib/checkinSchema";
import { countries } from "@/content/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, localDateStr } from "@/lib/utils";
import { CameraIcon, UploadIcon, CheckCircle2Icon, XIcon } from "lucide-react";

const countryDialCodes: Record<string, string> = {
  India: "+91", Afghanistan: "+93", Albania: "+355", Algeria: "+213",
  Argentina: "+54", Australia: "+61", Austria: "+43", Bangladesh: "+880",
  Belgium: "+32", Bhutan: "+975", Brazil: "+55", Cambodia: "+855",
  Canada: "+1", Chile: "+56", China: "+86", Colombia: "+57",
  Denmark: "+45", Egypt: "+20", Finland: "+358", France: "+33",
  Germany: "+49", Greece: "+30", Hungary: "+36", Iceland: "+354",
  Indonesia: "+62", Iran: "+98", Iraq: "+964", Ireland: "+353",
  Israel: "+972", Italy: "+39", Japan: "+81", Jordan: "+962",
  Kenya: "+254", Kuwait: "+965", Malaysia: "+60", Maldives: "+960",
  Mexico: "+52", Morocco: "+212", Myanmar: "+95", Nepal: "+977",
  Netherlands: "+31", "New Zealand": "+64", Nigeria: "+234", Norway: "+47",
  Oman: "+968", Pakistan: "+92", Philippines: "+63", Poland: "+48",
  Portugal: "+351", Qatar: "+974", Romania: "+40", Russia: "+7",
  "Saudi Arabia": "+966", Singapore: "+65", "South Africa": "+27",
  "South Korea": "+82", Spain: "+34", "Sri Lanka": "+94", Sweden: "+46",
  Switzerland: "+41", Thailand: "+66", Turkey: "+90", "United Arab Emirates": "+971",
  "United Kingdom": "+44", "United States": "+1", Vietnam: "+84",
};

function getNow() {
  const now = new Date();
  const date = localDateStr(now);
  const time = now.toTimeString().slice(0, 5);
  return { date, time };
}

function CountrySelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = countries.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search country..."
        value={open ? search : value}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className={cn(error && "border-brand-red ring-brand-red/20")}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-brand-mist bg-white dark:bg-card shadow-lift dark:shadow-none">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-brand-green-dark/60">
              No country found
            </li>
          ) : (
            filtered.map((c) => (
              <li
                key={c}
                className={cn(
                  "cursor-pointer px-4 py-2.5 text-sm transition-colors hover:bg-brand-sand",
                  c === value && "bg-brand-green/[0.06] font-medium text-brand-green"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setSearch("");
                  setOpen(false);
                  inputRef.current?.blur();
                }}
              >
                {c}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

type DocFile = { file: File; preview: string };

const ACCEPTED_FILE_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

function MultiDocUpload({
  label,
  error,
  files,
  onAdd,
  onRemove,
  onValidate,
  validating,
  validationMsg,
  helpText,
}: {
  label: string;
  error?: string;
  files: DocFile[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  onValidate?: () => void;
  validating?: boolean;
  validationMsg?: { valid: boolean; message: string } | null;
  helpText?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") return;
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds 10 MB limit. Please use a smaller file.`);
        return;
      }
      onAdd(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  return (
    <div>
      <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
        {label}
      </Label>

      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {files.map((doc, i) => (
            <div key={i} className="relative">
              {doc.file.type === "application/pdf" ? (
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 shadow-soft dark:shadow-none">
                  <span className="text-2xl">PDF</span>
                  <span className="mt-1 max-w-[5rem] truncate text-[9px] text-brand-green-dark/60">{doc.file.name}</span>
                </div>
              ) : (
                <img
                  src={doc.preview}
                  alt={`Document ${i + 1}`}
                  className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft dark:shadow-none"
                />
              )}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-red text-white shadow-md dark:shadow-none"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-4 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
        >
          <UploadIcon className="h-5 w-5 text-brand-green" />
          {files.length > 0 ? "Add more" : "Upload file"}
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-4 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
        >
          <CameraIcon className="h-5 w-5 text-brand-green" />
          Take photo
        </button>
      </div>

      {files.length > 0 && onValidate && (
        <button
          type="button"
          onClick={onValidate}
          disabled={validating}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-green/[0.08] px-4 py-2 text-sm font-medium text-brand-green transition-colors hover:bg-brand-green/[0.14] disabled:opacity-50"
        >
          {validating ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
              Verifying...
            </>
          ) : (
            "Verify document"
          )}
        </button>
      )}

      {validationMsg && !validating && (
        <p className={cn("mt-2 text-sm font-medium", validationMsg.valid ? "text-brand-green" : "text-brand-red")}>
          {validationMsg.valid ? "✓ " : "✗ "}{validationMsg.message}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="mt-1.5 text-xs text-brand-red">{error}</p>}
      <p className="mt-1.5 text-xs text-brand-green-dark/50">
        {helpText || "Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."}
      </p>
    </div>
  );
}

function driveThumb(link: string): string | null {
  const m = link.match(/\/d\/([^/]+)\//);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w200` : null;
}

type LookupData = {
  name: string;
  contactNumber: string;
  comingFrom: string;
  nationality: string;
  emergencyName: string;
  emergencyPhone: string;
  idType: string;
  idCardLink: string;
  visaLink: string;
  formCData: string;
};

export function SelfCheckinForm() {
  const { date, time } = getNow();

  const [step, setStep] = useState<"phone" | "form">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [returnGuest, setReturnGuest] = useState<LookupData | null>(null);
  const [prevIdCardLink, setPrevIdCardLink] = useState("");
  const [prevVisaLink, setPrevVisaLink] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [idFiles, setIdFiles] = useState<DocFile[]>([]);
  const [visaFiles, setVisaFiles] = useState<DocFile[]>([]);
  const [idValidationMsg, setIdValidationMsg] = useState<{ valid: boolean; message: string } | null>(null);
  const [validatingId, setValidatingId] = useState(false);
  const [idValidated, setIdValidated] = useState(false);
  const [idServerError, setIdServerError] = useState(false);
  const [visaValidationMsg, setVisaValidationMsg] = useState<{ valid: boolean; message: string } | null>(null);
  const [validatingVisa, setValidatingVisa] = useState(false);
  const [visaServerError, setVisaServerError] = useState(false);
  const [validationEnabled, setValidationEnabled] = useState(true);
  const [validationLoaded, setValidationLoaded] = useState(false);
  const [detectedIdType, setDetectedIdType] = useState<string | null>(null);
  const prefilledNameRef = useRef<{ firstName: string; lastName: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.image_validation === "off") {
          setValidationEnabled(false);
          setIdValidated(true);
        }
      })
      .catch(() => {})
      .finally(() => setValidationLoaded(true));
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<CheckinFormData>({
    resolver: zodResolver(checkinSchema),
    defaultValues: {
      bookingPlatform: undefined,
      bookingId: "",
      arrivalDate: date,
      arrivalTime: time,
      firstName: "",
      lastName: "",
      numberOfPersons: "",
      contactNumber: "",
      stayingDays: "",
      comingFrom: "",
      nationality: "India",
      emergencyName: "",
      emergencyPhone: "",
      idType: undefined,
    },
  });

  const nationality = watch("nationality");
  const idType = watch("idType");
  const bookingPlatform = watch("bookingPlatform");
  const bookingId = watch("bookingId");
  const numberOfPersons = watch("numberOfPersons");
  const stayingDays = watch("stayingDays");
  const firstName = watch("firstName");
  const lastName = watch("lastName");
  const needsBookingId = bookingPlatform && bookingPlatform !== "Offline booking" && bookingPlatform !== "Walk-in";

  useEffect(() => {
    if (isForeignNationality(nationality) && idType !== "passport") {
      setValue("idType", "passport", { shouldValidate: true });
    }
  }, [idType, nationality, setValue]);

  useEffect(() => {
    if (!prefilledNameRef.current || !prevIdCardLink || idFiles.length > 0) return;
    const { firstName: origFirst, lastName: origLast } = prefilledNameRef.current;
    if (firstName !== origFirst || lastName !== origLast) {
      setPrevIdCardLink("");
      setValue("prevIdCardLink", undefined);
      setIdValidated(false);
    }
  }, [firstName, lastName, prevIdCardLink, idFiles.length, setValue]);

  const handlePhoneLookup = async () => {
    const cleaned = phoneInput.replace(/[\s\-]/g, "");
    if (cleaned.length < 7) {
      setLookupError("Please enter a valid mobile number");
      return;
    }
    setLookingUp(true);
    setLookupError("");
    try {
      const res = await fetch(`/api/checkin/lookup?phone=${encodeURIComponent(cleaned)}`);
      const json = await res.json();
      if (json.found && json.data) {
        const d = json.data as LookupData;
        setReturnGuest(d);
        setPrevIdCardLink(d.idCardLink || "");
        setPrevVisaLink(d.visaLink || "");

        const { date: nowDate, time: nowTime } = getNow();
        const formCFields: Record<string, string> = {};
        if (d.formCData) {
          try {
            const fc = JSON.parse(d.formCData);
            for (const key of [
              "arrivedFromCountry", "arrivedFromCity", "arrivedFromPlace",
              "dateOfArrivalInIndia", "purposeOfVisit", "employedInIndia",
              "nextDestination", "nextDestState", "nextDestCity", "nextDestPlace",
              "homeAddress", "homeCity", "homeCountryPhone",
            ]) {
              if (fc[key]) formCFields[key] = fc[key];
            }
          } catch { /* ignore parse errors */ }
        }

        const nameParts = (d.name || "").trim().split(/\s+/);
        const prefillFirst = nameParts[0] || "";
        const prefillLast = nameParts.slice(1).join(" ") || "";
        prefilledNameRef.current = { firstName: prefillFirst, lastName: prefillLast };

        reset({
          arrivalDate: nowDate,
          arrivalTime: nowTime,
          firstName: prefillFirst,
          lastName: prefillLast,
          numberOfPersons: "",
          contactNumber: d.contactNumber,
          stayingDays: "",
          comingFrom: d.comingFrom,
          nationality: d.nationality || "India",
          emergencyName: d.emergencyName,
          emergencyPhone: d.emergencyPhone,
          idType: (["aadhaar", "driving_licence", "passport"].includes(d.idType) ? d.idType : undefined) as any,
          bookingPlatform: undefined as any,
          bookingId: "",
          prevIdCardLink: d.idCardLink || undefined,
          prevVisaLink: d.visaLink || undefined,
          ...formCFields,
        });

        if (d.idCardLink) {
          setIdValidated(true);
        }
      } else {
        setReturnGuest(null);
        setPrevIdCardLink("");
        setPrevVisaLink("");
        prefilledNameRef.current = null;
        setValue("contactNumber", cleaned);
      }
      setStep("form");
    } catch {
      setLookupError("Could not look up your number. Please try again.");
    } finally {
      setLookingUp(false);
    }
  };

  const skipToForm = () => {
    setReturnGuest(null);
    setPrevIdCardLink("");
    setPrevVisaLink("");
    prefilledNameRef.current = null;
    const cleaned = phoneInput.replace(/[\s\-]/g, "");
    if (cleaned.length >= 7) {
      setValue("contactNumber", cleaned);
    }
    setStep("form");
  };

  const addIdFile = (file: File) => {
    setPrevIdCardLink("");
    setValue("prevIdCardLink", undefined);
    setIdValidated(false);

    if (file.type === "application/pdf") {
      const newFiles = [...idFiles, { file, preview: "" }];
      setIdFiles(newFiles);
      setValue("idImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setIdValidationMsg(null);
      if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const newFiles = [...idFiles, { file, preview: e.target?.result as string }];
      setIdFiles(newFiles);
      setValue("idImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setIdValidationMsg(null);
      if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    };
    reader.readAsDataURL(file);
  };

  const removeIdFile = (index: number) => {
    const newFiles = idFiles.filter((_, i) => i !== index);
    setIdFiles(newFiles);
    setValue("idImages", newFiles.length > 0 ? newFiles.map((f) => f.file) : null, { shouldValidate: true });
    if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    setIdValidationMsg(null);
  };

  const validateIdFiles = async () => {
    if (idFiles.length === 0) return;
    setValidatingId(true);
    setIdValidationMsg(null);
    setIdServerError(false);
    try {
      const idType = watch("idType");
      const fn = watch("firstName");
      const ln = watch("lastName");
      const guestName = [fn, ln].filter(Boolean).join(" ").trim() || undefined;
      const formData = new FormData();
      idFiles.forEach((doc) => formData.append("file", doc.file));
      formData.append("category", "id");
      if (idType) formData.append("idType", idType);
      if (guestName) formData.append("guestName", guestName);

      const res = await fetch("/api/validate-id", { method: "POST", body: formData });

      if (res.status === 503 || res.status >= 500) {
        setIdValidationMsg({ valid: false, message: "Validation service temporarily unavailable. You can still submit — staff will verify manually." });
        setIdValidated(false);
        setIdServerError(true);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setIdValidationMsg({ valid: false, message: errData.error || "Invalid file. Please try a different image." });
        setIdValidated(false);
        setIdFiles([]);
        setValue("idImages", null, { shouldValidate: true });
        return;
      }

      const result = await res.json();

      if (result.valid && result.needsBackSide) {
        setIdValidationMsg({ valid: true, message: result.message || "Please also upload the back side of your Aadhaar." });
        setIdValidated(true);
        setDetectedIdType(null);
      } else if (result.valid) {
        setIdValidationMsg({ valid: true, message: result.message });
        setIdValidated(true);
        setDetectedIdType(null);
      } else {
        setIdValidationMsg({ valid: false, message: result.message });
        if (result.layers?.includes("type_mismatch") && result.documentType !== "unknown") {
          setIdValidated(false);
          setDetectedIdType(result.documentType);
        } else {
          setIdValidated(false);
          setDetectedIdType(null);
          setIdFiles([]);
          setValue("idImages", null, { shouldValidate: true });
        }
      }
    } catch {
      setIdValidationMsg({ valid: false, message: "Validation service temporarily unavailable. You can still submit — staff will verify manually." });
      setIdValidated(false);
      setIdServerError(true);
    } finally {
      setValidatingId(false);
    }
  };

  const addVisaFile = (file: File) => {
    setPrevVisaLink("");
    setValue("prevVisaLink", undefined);

    if (file.type === "application/pdf") {
      const newFiles = [...visaFiles, { file, preview: "" }];
      setVisaFiles(newFiles);
      setValue("visaImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setVisaValidationMsg(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const newFiles = [...visaFiles, { file, preview: e.target?.result as string }];
      setVisaFiles(newFiles);
      setValue("visaImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setVisaValidationMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const removeVisaFile = (index: number) => {
    const newFiles = visaFiles.filter((_, i) => i !== index);
    setVisaFiles(newFiles);
    setValue("visaImages", newFiles.length > 0 ? newFiles.map((f) => f.file) : null, { shouldValidate: true });
    if (newFiles.length === 0) setVisaValidationMsg(null);
  };

  const validateVisaFiles = async () => {
    if (visaFiles.length === 0) return;
    setValidatingVisa(true);
    setVisaValidationMsg(null);
    setVisaServerError(false);
    try {
      const firstImage = visaFiles.find((f) => f.file.type.startsWith("image/"));
      const fileToValidate = firstImage?.file || visaFiles[0].file;

      const formData = new FormData();
      formData.append("file", fileToValidate);
      formData.append("category", "visa");

      const res = await fetch("/api/validate-id", { method: "POST", body: formData });

      if (res.status === 503 || res.status >= 500) {
        setVisaValidationMsg({ valid: false, message: "Validation service temporarily unavailable. You can still submit — staff will verify manually." });
        setVisaServerError(true);
        return;
      }

      const result = await res.json();
      setVisaValidationMsg({ valid: result.valid, message: result.message });

      if (!result.valid) {
        setVisaFiles([]);
        setValue("visaImages", null, { shouldValidate: true });
      }
    } catch {
      setVisaValidationMsg({ valid: false, message: "Validation service temporarily unavailable. You can still submit — staff will verify manually." });
      setVisaServerError(true);
    } finally {
      setValidatingVisa(false);
    }
  };

  const onSubmit = async (data: CheckinFormData) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("bookingPlatform", data.bookingPlatform);
      if (data.bookingId) formData.append("bookingId", data.bookingId);
      formData.append("arrivalDate", data.arrivalDate);
      formData.append("arrivalTime", data.arrivalTime);
      formData.append("name", `${data.firstName.trim()} ${data.lastName.trim()}`);
      formData.append("numberOfPersons", data.numberOfPersons);
      formData.append("contactNumber", data.contactNumber);
      formData.append("stayingDays", data.stayingDays);
      formData.append("comingFrom", data.comingFrom);
      formData.append("nationality", data.nationality);
      formData.append("emergencyName", data.emergencyName);
      formData.append("emergencyPhone", data.emergencyPhone);
      formData.append("idType", data.idType);
      if (data.dob) formData.append("dob", data.dob);

      if (idFiles.length > 0) {
        idFiles.forEach((doc) => {
          formData.append("idImages", doc.file);
        });
      } else if (prevIdCardLink) {
        formData.append("prevIdCardLink", prevIdCardLink);
      }

      if (visaFiles.length > 0) {
        visaFiles.forEach((doc) => {
          formData.append("visaImages", doc.file);
        });
      } else if (prevVisaLink) {
        formData.append("prevVisaLink", prevVisaLink);
      }

      if (isForeignNationality(data.nationality)) {
        if (data.arrivedFromCountry) formData.append("arrivedFromCountry", data.arrivedFromCountry);
        if (data.arrivedFromCity) formData.append("arrivedFromCity", data.arrivedFromCity);
        if (data.arrivedFromPlace) formData.append("arrivedFromPlace", data.arrivedFromPlace);
        if (data.dateOfArrivalInIndia) formData.append("dateOfArrivalInIndia", data.dateOfArrivalInIndia);
        if (data.purposeOfVisit) formData.append("purposeOfVisit", data.purposeOfVisit);
        if (data.employedInIndia) formData.append("employedInIndia", data.employedInIndia);
        if (data.nextDestination) formData.append("nextDestination", data.nextDestination);
        if (data.nextDestState) formData.append("nextDestState", data.nextDestState);
        if (data.nextDestCity) formData.append("nextDestCity", data.nextDestCity);
        if (data.nextDestPlace) formData.append("nextDestPlace", data.nextDestPlace);
        if (data.homeAddress) formData.append("homeAddress", data.homeAddress);
        if (data.homeCity) formData.append("homeCity", data.homeCity);
        if (data.homeCountryPhone) formData.append("homeCountryPhone", data.homeCountryPhone);
      }

      const res = await fetch("/api/checkin", {
        method: "POST",
        body: formData,
      });

      if (res.status === 422) {
        const errData = await res.json();
        alert(errData.error || "Document validation failed. Please upload a valid document.");
        if (errData.field === "visaImages") {
          setVisaFiles([]);
          setVisaValidationMsg({ valid: false, message: errData.error || "Visa rejected" });
        } else {
          setIdServerError(false);
          setIdValidated(false);
          setIdValidationMsg({ valid: false, message: errData.error || "ID validation failed. Please re-upload your document." });
        }
        return;
      }

      if (!res.ok) throw new Error("Submission failed");

      setSuccess(true);
      reset();
      setIdFiles([]);
      setVisaFiles([]);
      setIdValidationMsg(null);
      setVisaValidationMsg(null);
      setIdValidated(false);
      setIdServerError(false);
      setVisaServerError(false);
      setDetectedIdType(null);
      setReturnGuest(null);
      setPrevIdCardLink("");
      setPrevVisaLink("");
    } catch {
      alert("Something went wrong. Please try again or contact the front desk.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "phone" && !success && !submitting) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-brand-mist bg-white dark:bg-card p-6 shadow-card dark:shadow-none md:p-10">
        <h2 className="font-display text-2xl font-bold text-brand-green md:text-3xl">
          Guest Self Check-in
        </h2>
        <p className="mt-2 text-sm text-brand-green-dark/70">
          Enter your mobile number to get started. If you&apos;ve stayed with us before, we&apos;ll load your details.
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <Label htmlFor="phoneLookup">Mobile number (without country code)</Label>
            <Input
              id="phoneLookup"
              type="tel"
              inputMode="tel"
              placeholder="e.g. 9876543210"
              value={phoneInput}
              onChange={(e) => { setPhoneInput(e.target.value); setLookupError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlePhoneLookup(); } }}
              className={cn(lookupError && "border-brand-red")}
              autoFocus
            />
            {lookupError && (
              <p className="mt-1 text-xs text-brand-red">{lookupError}</p>
            )}
          </div>

          <Button
            type="button"
            variant="cta"
            className="w-full"
            onClick={handlePhoneLookup}
            disabled={lookingUp}
          >
            {lookingUp ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Looking up...
              </span>
            ) : (
              "Continue"
            )}
          </Button>

          <button
            type="button"
            onClick={skipToForm}
            className="block w-full text-center text-sm text-brand-green-dark/60 transition-colors hover:text-brand-green"
          >
            Skip, I&apos;m a new guest
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-brand-mist bg-white dark:bg-card p-6 shadow-card dark:shadow-none md:p-10">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <CheckCircle2Icon className="h-8 w-8 text-brand-green" />
          </div>
          <h2 className="mt-5 font-display text-2xl font-bold text-brand-green">
            Check-in complete!
          </h2>
          <p className="mt-2 text-brand-green-dark/80">
            Welcome to Goko Hostel. Our team has been notified. Enjoy your stay!
          </p>
        </div>

        {/* Property Rules */}
        <div className="mt-6 rounded-2xl bg-brand-sand/50 p-5">
          <h3 className="font-display text-base font-bold text-brand-green-dark">House Rules</h3>
          <div className="mt-3 space-y-2 text-sm text-brand-green-dark/80">
            <div className="flex gap-2"><span>🎒</span><p><strong>Solo Travelers & Small Groups (Max 4) Only.</strong> We don&apos;t accommodate large groups.</p></div>
            <div className="flex gap-2"><span>🎂</span><p><strong>Age Limit:</strong> 18 to 35 years only.</p></div>
            <div className="flex gap-2"><span>🌿</span><p><strong>Non-AC Property:</strong> We don&apos;t have air conditioning, but each bed has an individual fan.</p></div>
            <div className="flex gap-2"><span>🚶</span><p><strong>Parking & Access:</strong> Hostel is 300m from parking via a scenic trail. Backpacks recommended.</p></div>
            <div className="flex gap-2"><span>🚫</span><p><strong>Strictly No:</strong> Hard liquor, drugs, outside food & drinks.</p></div>
          </div>
          <div className="mt-4 flex gap-4 rounded-xl bg-white dark:bg-card p-3 text-sm">
            <div><strong className="text-brand-green">Check-in:</strong> <span className="text-brand-green-dark/70">12:00 Noon</span></div>
            <div><strong className="text-brand-green">Check-out:</strong> <span className="text-brand-green-dark/70">10:00 AM</span></div>
          </div>
          <p className="mt-3 text-xs text-brand-green-dark/50">
            Goko Management reserves the right to cancel any booking if terms and conditions are not met.
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            type="button"
            variant="cta"
            onClick={() => { setSuccess(false); setStep("phone"); setPhoneInput(""); }}
          >
            OK, Got it
          </Button>
          <button
            type="button"
            onClick={() => { setSuccess(false); setStep("phone"); setPhoneInput(""); }}
            className="text-sm text-brand-green-dark/60 hover:text-brand-green"
          >
            Submit another check-in
          </button>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-brand-mist bg-white dark:bg-card p-12 text-center shadow-card dark:shadow-none md:p-16">
        <div className="mx-auto flex h-20 w-20 items-center justify-center">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-brand-green/20 border-t-brand-green" />
        </div>
        <h2 className="mt-8 font-display text-2xl font-bold text-brand-green">
          Submitting your check-in...
        </h2>
        <p className="mt-3 text-brand-green-dark/70">
          Uploading documents and saving your details. Please do not close this page or press back.
        </p>
        <div className="mt-6 flex justify-center gap-1">
          <div className="h-2 w-2 animate-bounce rounded-full bg-brand-green [animation-delay:0ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-brand-green [animation-delay:150ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-brand-green [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mx-auto max-w-2xl rounded-3xl border border-brand-mist bg-white dark:bg-card p-6 shadow-card dark:shadow-none md:p-10"
    >
      <h2 className="font-display text-2xl font-bold text-brand-green md:text-3xl">
        Guest Self Check-in
      </h2>
      <p className="mt-2 text-sm text-brand-green-dark/70">
        Please fill in your details. Fields marked with <span className="text-brand-red">*</span> are required.
      </p>

      {returnGuest && (
        <div className="mt-4 rounded-2xl border border-brand-green/20 bg-brand-green/[0.04] p-4">
          <p className="text-sm font-medium text-brand-green">
            Welcome back, {returnGuest.name}! We&apos;ve loaded your previous details. Please review and update if needed.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {/* Date & Time */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="arrivalDate">Date of arrival <span className="text-brand-red">*</span></Label>
            <Input
              id="arrivalDate"
              type="date"
              {...register("arrivalDate")}
              className={cn(errors.arrivalDate && "border-brand-red")}
            />
            {errors.arrivalDate && (
              <p className="mt-1 text-xs text-brand-red">{errors.arrivalDate.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="arrivalTime">Time of arrival <span className="text-brand-red">*</span></Label>
            <Input
              id="arrivalTime"
              type="time"
              {...register("arrivalTime")}
              className={cn(errors.arrivalTime && "border-brand-red")}
            />
            {errors.arrivalTime && (
              <p className="mt-1 text-xs text-brand-red">{errors.arrivalTime.message}</p>
            )}
          </div>
        </div>

        {/* Booking Platform & Booking ID */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bookingPlatform">Booking platform <span className="text-brand-red">*</span></Label>
            <select
              id="bookingPlatform"
              {...register("bookingPlatform")}
              className={cn(
                "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring",
                errors.bookingPlatform && "border-brand-red",
                returnGuest && !bookingPlatform && "border-amber-400 ring-2 ring-amber-100"
              )}
            >
              <option value="">Select platform...</option>
              {BOOKING_PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {returnGuest && !bookingPlatform && !errors.bookingPlatform && (
              <p className="mt-1 text-xs font-medium text-amber-600">Please fill in for this visit</p>
            )}
            {errors.bookingPlatform && (
              <p className="mt-1 text-xs text-brand-red">{errors.bookingPlatform.message}</p>
            )}
          </div>
          {needsBookingId && (
            <div>
              <Label htmlFor="bookingId">Booking ID <span className="text-brand-red">*</span></Label>
              <Input
                id="bookingId"
                placeholder="e.g. 4829173650"
                {...register("bookingId")}
                className={cn(
                  errors.bookingId && "border-brand-red",
                  returnGuest && !bookingId && "border-amber-400 ring-2 ring-amber-100"
                )}
              />
              {returnGuest && !bookingId && !errors.bookingId && (
                <p className="mt-1 text-xs font-medium text-amber-600">Please fill in for this visit</p>
              )}
              {errors.bookingId && (
                <p className="mt-1 text-xs text-brand-red">{errors.bookingId.message}</p>
              )}
            </div>
          )}
        </div>

        {/* Name */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First name <span className="text-brand-red">*</span></Label>
            <Input
              id="firstName"
              placeholder="First name"
              {...register("firstName")}
              className={cn(errors.firstName && "border-brand-red")}
              autoComplete="given-name"
            />
            {errors.firstName && (
              <p className="mt-1 text-xs text-brand-red">{errors.firstName.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="lastName">Last name <span className="text-brand-red">*</span></Label>
            <Input
              id="lastName"
              placeholder="Last name"
              {...register("lastName")}
              className={cn(errors.lastName && "border-brand-red")}
              autoComplete="family-name"
            />
            {errors.lastName && (
              <p className="mt-1 text-xs text-brand-red">{errors.lastName.message}</p>
            )}
          </div>
        </div>

        {/* Date of Birth */}
        <div>
          <Label htmlFor="dob">Date of Birth</Label>
          <Input
            id="dob"
            type="date"
            {...register("dob")}
            className="mt-1"
          />
        </div>

        {/* Number of persons & Staying days */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="numberOfPersons">Number of persons <span className="text-brand-red">*</span></Label>
            <Input
              id="numberOfPersons"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 2"
              {...register("numberOfPersons")}
              className={cn(
                errors.numberOfPersons && "border-brand-red",
                returnGuest && !numberOfPersons && "border-amber-400 ring-2 ring-amber-100"
              )}
            />
            {returnGuest && !numberOfPersons && !errors.numberOfPersons && (
              <p className="mt-1 text-xs font-medium text-amber-600">Please fill in for this visit</p>
            )}
            {errors.numberOfPersons && (
              <p className="mt-1 text-xs text-brand-red">
                {errors.numberOfPersons.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="stayingDays">Staying number of days <span className="text-brand-red">*</span></Label>
            <Input
              id="stayingDays"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 3"
              {...register("stayingDays")}
              className={cn(
                errors.stayingDays && "border-brand-red",
                returnGuest && !stayingDays && "border-amber-400 ring-2 ring-amber-100"
              )}
            />
            {returnGuest && !stayingDays && !errors.stayingDays && (
              <p className="mt-1 text-xs font-medium text-amber-600">Please fill in for this visit</p>
            )}
            {errors.stayingDays && (
              <p className="mt-1 text-xs text-brand-red">{errors.stayingDays.message}</p>
            )}
          </div>
        </div>

        {/* Nationality */}
        <div>
          <Label>Nationality <span className="text-brand-red">*</span></Label>
          <CountrySelect
            value={nationality}
            onChange={(val) => setValue("nationality", val, { shouldValidate: true })}
            error={errors.nationality?.message}
          />
          {errors.nationality && (
            <p className="mt-1 text-xs text-brand-red">{errors.nationality.message}</p>
          )}
        </div>

        {/* Coming from */}
        <div>
          <Label htmlFor="comingFrom">Coming from (city/place) <span className="text-brand-red">*</span></Label>
          <Input
            id="comingFrom"
            placeholder="e.g. Mumbai"
            {...register("comingFrom")}
            className={cn(errors.comingFrom && "border-brand-red")}
          />
          {errors.comingFrom && (
            <p className="mt-1 text-xs text-brand-red">{errors.comingFrom.message}</p>
          )}
        </div>

        {/* Contact number */}
        <div>
          <Label htmlFor="contactNumber">Contact number <span className="text-brand-red">*</span></Label>
          <div className="flex gap-2">
            <div className="flex h-8 w-[5rem] shrink-0 items-center justify-center rounded-lg border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
              {countryDialCodes[nationality] || "+91"}
            </div>
            <Input
              id="contactNumber"
              type="tel"
              inputMode="tel"
              placeholder="98765 43210"
              {...register("contactNumber")}
              className={cn("flex-1", errors.contactNumber && "border-brand-red")}
              autoComplete="tel"
            />
          </div>
          {errors.contactNumber && (
            <p className="mt-1 text-xs text-brand-red">{errors.contactNumber.message}</p>
          )}
        </div>

        {/* Emergency contact */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="emergencyName">Emergency contact name <span className="text-brand-red">*</span></Label>
            <Input
              id="emergencyName"
              placeholder="e.g. Parent or friend"
              {...register("emergencyName")}
              className={cn(errors.emergencyName && "border-brand-red")}
            />
            {errors.emergencyName && (
              <p className="mt-1 text-xs text-brand-red">{errors.emergencyName.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="emergencyPhone">Emergency contact phone <span className="text-brand-red">*</span></Label>
            <div className="flex gap-2">
              <div className="flex h-8 w-[5rem] shrink-0 items-center justify-center rounded-lg border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
                {countryDialCodes[nationality] || "+91"}
              </div>
              <Input
                id="emergencyPhone"
                type="tel"
                inputMode="tel"
                placeholder="98765 43210"
                {...register("emergencyPhone")}
                className={cn("flex-1", errors.emergencyPhone && "border-brand-red")}
              />
            </div>
            {errors.emergencyPhone && (
              <p className="mt-1 text-xs text-brand-red">{errors.emergencyPhone.message}</p>
            )}
          </div>
        </div>

        {/* ID Type Selection */}
        <div>
          <Label htmlFor="idType">ID document type <span className="text-brand-red">*</span></Label>
          <select
            id="idType"
            {...register("idType")}
            onChange={(e) => {
              setValue("idType", e.target.value as any, { shouldValidate: true });
              if (detectedIdType && e.target.value === detectedIdType && idFiles.length > 0) {
                setIdValidated(true);
                setIdValidationMsg({ valid: true, message: `${detectedIdType.replace("_", " ")} detected. ID type updated.` });
                setDetectedIdType(null);
              }
            }}
            className={cn(
              "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring",
              errors.idType && "border-brand-red"
            )}
          >
            {!isForeignNationality(nationality) && <option value="">Select ID type...</option>}
            {!isForeignNationality(nationality) && <option value="aadhaar">Aadhaar Card</option>}
            {!isForeignNationality(nationality) && <option value="driving_licence">Driving Licence</option>}
            <option value="passport">Passport</option>
          </select>
          {errors.idType && (
            <p className="mt-1 text-xs text-brand-red">{errors.idType.message}</p>
          )}
        </div>

        {/* Previous ID preview for return guests */}
        {prevIdCardLink && idFiles.length === 0 && (
          <div>
            <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
              ID document (from previous visit)
            </Label>
            <div className="mb-2 flex flex-wrap gap-3">
              {prevIdCardLink.split(" | ").map((link, i) => {
                const thumb = driveThumb(link);
                return thumb ? (
                  <img
                    key={i}
                    src={thumb}
                    alt={`Previous ID ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft dark:shadow-none"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div key={i} className="flex h-24 w-24 items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 shadow-soft dark:shadow-none">
                    <span className="text-[10px] text-brand-green-dark/60">ID on file</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-brand-green-dark/50">
              Your previous ID is on file. Upload new documents below only if you want to replace them.
            </p>
          </div>
        )}

        {/* ID Upload (multiple images/PDF) */}
        <MultiDocUpload
          label={prevIdCardLink && idFiles.length === 0 ? "Upload new ID (optional)" : "ID document (upload front & back) *"}
          error={errors.idImages?.message as string | undefined}
          files={idFiles}
          onAdd={addIdFile}
          onRemove={removeIdFile}
          onValidate={validationEnabled && !prevIdCardLink ? validateIdFiles : undefined}
          validating={validatingId}
          validationMsg={validationEnabled ? idValidationMsg : null}
          helpText="Upload front and back of your ID. Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."
        />

        {/* Previous Visa preview for return guests */}
        {isForeignNationality(nationality) && prevVisaLink && visaFiles.length === 0 && (
          <div>
            <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
              Visa document (from previous visit)
            </Label>
            <div className="mb-2 flex flex-wrap gap-3">
              {prevVisaLink.split(" | ").map((link, i) => {
                const thumb = driveThumb(link);
                return thumb ? (
                  <img
                    key={i}
                    src={thumb}
                    alt={`Previous Visa ${i + 1}`}
                    className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft dark:shadow-none"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div key={i} className="flex h-24 w-24 items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 shadow-soft dark:shadow-none">
                    <span className="text-[10px] text-brand-green-dark/60">Visa on file</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-brand-green-dark/50">
              Your previous visa is on file. Upload new documents below only if you want to replace them.
            </p>
          </div>
        )}

        {/* Visa (conditional, multiple images/PDF) */}
        {isForeignNationality(nationality) && (
          <MultiDocUpload
            label={prevVisaLink && visaFiles.length === 0 ? "Upload new visa (optional)" : "Visa document (required for non-Indian nationals)"}
            error={errors.visaImages?.message as string | undefined}
            files={visaFiles}
            onAdd={addVisaFile}
            onRemove={removeVisaFile}
            onValidate={validationEnabled && !prevVisaLink ? validateVisaFiles : undefined}
            validating={validatingVisa}
            validationMsg={validationEnabled ? visaValidationMsg : null}
            helpText="Upload visa pages. Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."
          />
        )}

        {/* Foreign guest Form C fields */}
        {isForeignNationality(nationality) && (
          <div className="space-y-5 rounded-2xl border border-brand-green/20 dark:border-brand-green/30 bg-brand-green/[0.06] dark:bg-brand-green/10 p-5">
            <p className="text-sm font-semibold text-brand-green-dark dark:text-brand-green">Additional details for foreign nationals (required for Form C)</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="arrivedFromCountry">Arrived from country <span className="text-brand-red">*</span></Label>
                <CountrySelect
                  value={watch("arrivedFromCountry") || ""}
                  onChange={(val) => setValue("arrivedFromCountry", val, { shouldValidate: true })}
                  error={errors.arrivedFromCountry?.message}
                />
              </div>
              <div>
                <Label htmlFor="arrivedFromCity">Arrived from city</Label>
                <Input placeholder="e.g. London" {...register("arrivedFromCity")} className="mt-1" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="arrivedFromPlace">Arrived from place</Label>
                <Input placeholder="e.g. Heathrow Airport" {...register("arrivedFromPlace")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="dateOfArrivalInIndia">Date of arrival in India</Label>
                <Input type="date" {...register("dateOfArrivalInIndia")} className="mt-1" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="purposeOfVisit">Purpose of visit <span className="text-brand-red">*</span></Label>
                <select {...register("purposeOfVisit")} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">Select...</option>
                  <option value="Tourism">Tourism</option>
                  <option value="Business">Business</option>
                  <option value="Medical">Medical</option>
                  <option value="Education">Education</option>
                  <option value="Employment">Employment</option>
                  <option value="Conference">Conference</option>
                  <option value="Research">Research</option>
                  <option value="Transit">Transit</option>
                  <option value="Others">Others</option>
                </select>
              </div>
              <div>
                <Label htmlFor="employedInIndia">Employed in India?</Label>
                <select {...register("employedInIndia")} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
            </div>

            <div>
              <Label>Next destination</Label>
              <div className="mt-1 grid gap-3 sm:grid-cols-3">
                <select {...register("nextDestination")} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="Inside India">Inside India</option>
                  <option value="Outside India">Outside India</option>
                </select>
                <Input placeholder="State" {...register("nextDestState")} />
                <Input placeholder="City/Place" {...register("nextDestCity")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="homeAddress">Home country address</Label>
                <Input placeholder="Street address" {...register("homeAddress")} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="homeCity">Home city</Label>
                <Input placeholder="City" {...register("homeCity")} className="mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="homeCountryPhone">Phone number (home country)</Label>
              <Input type="tel" placeholder="e.g. +44 7700 900000" {...register("homeCountryPhone")} className="mt-1" />
            </div>
          </div>
        )}
      </div>

      <div className="mt-10">
        {validationLoaded && validationEnabled && !idValidated && !idServerError && idFiles.length > 0 && !prevIdCardLink && (
          <p className="mb-3 text-center text-sm text-brand-red">
            Please click &quot;Verify document&quot; before submitting
          </p>
        )}
        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={submitting || !validationLoaded || (validationEnabled && !idValidated && !idServerError && !prevIdCardLink)}
        >
          {submitting ? "Submitting..." : !validationLoaded ? "Loading..." : "Complete Check-in"}
        </Button>
      </div>
    </form>
  );
}
