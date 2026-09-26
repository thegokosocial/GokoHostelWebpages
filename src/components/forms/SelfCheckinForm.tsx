"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useRef, useEffect, useMemo } from "react";
import { checkinSchema, isForeignNationality, type CheckinFormData, BOOKING_PLATFORMS } from "@/lib/checkinSchema";
import { countries } from "@/content/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, localDateStr } from "@/lib/utils";
import { isStaffReviewValidation, messageFromCheckinFailure, messageFromCheckinCatch } from "@/lib/checkinSubmitError";
import { isAcceptedIdFile, isHeicFile, bothSidesHelpText, removeLinkFromJoined } from "@/lib/checkinIdUpload";
import { requiresBothIdSides } from "@/lib/idDocumentSides";
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
  id,
  value,
  onChange,
  error,
}: {
  id?: string;
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
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
            <li className="px-4 py-3 text-sm text-zinc-600">
              No country found
            </li>
          ) : (
            filtered.map((c) => (
              <li
                key={c}
                className={cn(
                  "cursor-pointer px-4 py-2.5 text-sm text-zinc-900 transition-colors hover:bg-brand-sand",
                  c === value && "bg-brand-green-dark font-medium text-brand-gold"
                )}
                onPointerDown={(e) => {
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
  showValidate,
}: {
  label: string;
  error?: string;
  files: DocFile[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  onValidate?: () => void;
  validating?: boolean;
  validationMsg?: { valid: boolean; message: string; staffReview?: boolean } | null;
  helpText?: string;
  /** When set, controls Verify visibility (e.g. dual slots where files live in the other slot). */
  showValidate?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      const check = isAcceptedIdFile(file);
      if (!check.ok) {
        alert(check.reason);
        return;
      }
      onAdd(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const canValidate = onValidate && (showValidate ?? files.length > 0);

  return (
    <div>
      <Label className="mb-2 block text-sm font-semibold text-zinc-900">
        {label}
      </Label>

      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {files.map((doc, i) => (
            <div key={i} className="relative">
              {doc.file.type === "application/pdf" ? (
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 shadow-soft dark:shadow-none">
                  <span className="text-2xl">PDF</span>
                  <span className="mt-1 max-w-[5rem] truncate text-[9px] text-zinc-600">{doc.file.name}</span>
                </div>
              ) : !doc.preview ? (
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 px-1 shadow-soft dark:shadow-none">
                  <span className="text-[10px] font-medium text-zinc-700">Image</span>
                  <span className="mt-1 max-w-[5rem] truncate text-[9px] text-zinc-600">{doc.file.name}</span>
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
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-400 bg-white/80 px-4 py-4 text-sm font-medium text-zinc-900 transition-colors hover:border-brand-green-dark/40 hover:bg-white"
        >
          <UploadIcon className="h-5 w-5 text-brand-green-dark" />
          {files.length > 0 ? "Add more" : "Upload file"}
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-400 bg-white/80 px-4 py-4 text-sm font-medium text-zinc-900 transition-colors hover:border-brand-green-dark/40 hover:bg-white"
        >
          <CameraIcon className="h-5 w-5 text-brand-green-dark" />
          Take photo
        </button>
      </div>

      {canValidate && (
        <button
          type="button"
          onClick={onValidate}
          disabled={validating}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-brand-gold bg-brand-green-dark px-4 py-2.5 text-sm font-semibold text-brand-gold shadow-sm transition-colors hover:bg-brand-green-dark/90 disabled:opacity-50"
        >
          {validating ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-gold border-t-transparent" />
              Verifying...
            </>
          ) : (
            "Verify document"
          )}
        </button>
      )}

      {validationMsg && !validating && (
        <p
          className={cn(
            "mt-2 text-sm font-semibold",
            validationMsg.staffReview
              ? "text-amber-800"
              : validationMsg.valid
                ? "text-zinc-900"
                : "text-brand-red"
          )}
        >
          {validationMsg.valid ? (validationMsg.staffReview ? "⚠ " : "✓ ") : "✗ "}
          {validationMsg.message}
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
      <p className="mt-1.5 text-xs text-zinc-600">
        {helpText || "Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."}
      </p>
    </div>
  );
}

function driveFileId(link: string): string | null {
  try {
    const url = new URL(link);
    const pathMatch = url.pathname.match(/\/d\/([^/]+)/);
    return pathMatch?.[1] || url.searchParams.get("id");
  } catch {
    return null;
  }
}

function driveThumb(link: string): string | null {
  const fileId = driveFileId(link);
  return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400` : null;
}

function PreviousDocumentPreview({
  link,
  label,
  index,
  onRemove,
}: {
  link: string;
  label: string;
  index: number;
  onRemove?: () => void;
}) {
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const thumb = driveThumb(link);
  const canOpen = /^https?:\/\//i.test(link);
  const previewSrc = thumb && previewAttempt < 2 ? `${thumb}&retry=${previewAttempt}` : null;

  const card = previewSrc ? (
    <img
      src={previewSrc}
      alt={`${label} ${index + 1}`}
      className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft dark:shadow-none"
      onError={() => setPreviewAttempt((attempt) => Math.min(attempt + 1, 2))}
    />
  ) : (
    <div className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 px-1 text-center shadow-soft dark:shadow-none">
      <span className="text-[10px] text-zinc-600">
        {canOpen ? "Preview unavailable" : `${label} on file`}
      </span>
      {canOpen && <span className="mt-1 text-[10px] font-medium text-brand-green-dark">Open document ↗</span>}
    </div>
  );

  const openable = canOpen ? (
    <a href={link} target="_blank" rel="noreferrer" aria-label={`Open ${label} ${index + 1}`}>
      {card}
    </a>
  ) : (
    card
  );

  return (
    <div className="relative inline-block">
      {openable}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label} ${index + 1}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-brand-red text-white shadow-md dark:shadow-none"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
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
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  const [idFrontFiles, setIdFrontFiles] = useState<DocFile[]>([]);
  const [idBackFiles, setIdBackFiles] = useState<DocFile[]>([]);
  /** Progressive second-side prompt after Verify finds front or address missing. */
  const [sidePrompt, setSidePrompt] = useState<"front" | "back" | null>(null);
  /** Guest voluntarily opened the other-side slot before Verify. */
  const [offerOtherSide, setOfferOtherSide] = useState(false);
  const [visaFiles, setVisaFiles] = useState<DocFile[]>([]);
  const [idValidationMsg, setIdValidationMsg] = useState<{ valid: boolean; message: string; staffReview?: boolean } | null>(null);
  const [validatingId, setValidatingId] = useState(false);
  const [idValidated, setIdValidated] = useState(false);
  const [idServerError, setIdServerError] = useState(false);
  const [visaValidationMsg, setVisaValidationMsg] = useState<{ valid: boolean; message: string; staffReview?: boolean } | null>(null);
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
  const numberOfPersons = watch("numberOfPersons");
  const stayingDays = watch("stayingDays");
  const firstName = watch("firstName");
  const lastName = watch("lastName");

  const bothSidesCapable = requiresBothIdSides(idType || "", nationality);
  const idFiles = useMemo(
    () => [...idFrontFiles, ...idBackFiles],
    [idFrontFiles, idBackFiles],
  );
  const prevIdOnly = Boolean(prevIdCardLink) && idFiles.length === 0;
  const showOtherSideSlot = !prevIdOnly && (sidePrompt !== null || offerOtherSide);

  const syncIdImages = (front: DocFile[], back: DocFile[]) => {
    const combined = [...front, ...back];
    setValue("idImages", combined.length > 0 ? combined.map((f) => f.file) : null, { shouldValidate: true });
  };

  const clearIdUploads = () => {
    setIdFrontFiles([]);
    setIdBackFiles([]);
    setSidePrompt(null);
    setOfferOtherSide(false);
    setValue("idImages", null, { shouldValidate: true });
  };

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

  const appendDocFile = (
    file: File,
    current: DocFile[],
    setFiles: (next: DocFile[]) => void,
    afterAdd: (next: DocFile[]) => void,
  ) => {
    const finish = (preview: string) => {
      const next = [...current, { file, preview }];
      setFiles(next);
      afterAdd(next);
    };
    if (file.type === "application/pdf" || isHeicFile(file)) {
      finish("");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => finish(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const addIdFrontFile = (file: File) => {
    setPrevIdCardLink("");
    setValue("prevIdCardLink", undefined);
    setIdValidated(false);
    appendDocFile(file, idFrontFiles, setIdFrontFiles, (next) => {
      syncIdImages(next, idBackFiles);
      setIdValidationMsg(null);
      if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    });
  };

  const addIdBackFile = (file: File) => {
    setPrevIdCardLink("");
    setValue("prevIdCardLink", undefined);
    setIdValidated(false);
    appendDocFile(file, idBackFiles, setIdBackFiles, (next) => {
      syncIdImages(idFrontFiles, next);
      setIdValidationMsg(null);
      if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    });
  };

  const removeIdFrontFile = (index: number) => {
    const next = idFrontFiles.filter((_, i) => i !== index);
    setIdFrontFiles(next);
    syncIdImages(next, idBackFiles);
    if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    setIdValidationMsg(null);
    if (next.length === 0 && idBackFiles.length === 0) {
      setSidePrompt(null);
      setOfferOtherSide(false);
    }
  };

  const removeIdBackFile = (index: number) => {
    const next = idBackFiles.filter((_, i) => i !== index);
    setIdBackFiles(next);
    syncIdImages(idFrontFiles, next);
    if (validationEnabled) { setIdValidated(false); setIdServerError(false); }
    setIdValidationMsg(null);
  };

  const validateIdFiles = async () => {
    if (idFiles.length === 0) return;
    setValidatingId(true);
    setIdValidationMsg(null);
    setIdServerError(false);
    try {
      const currentIdType = watch("idType");
      const fn = watch("firstName");
      const ln = watch("lastName");
      const guestName = [fn, ln].filter(Boolean).join(" ").trim() || undefined;
      const formData = new FormData();
      idFiles.forEach((doc) => formData.append("file", doc.file));
      formData.append("category", "id");
      if (currentIdType) formData.append("idType", currentIdType);
      if (guestName) formData.append("guestName", guestName);
      if (nationality) formData.append("nationality", nationality);

      const res = await fetch("/api/validate-id", { method: "POST", body: formData });

      if (res.status === 503 || res.status >= 500) {
        setIdValidationMsg({
          valid: false,
          staffReview: true,
          message: "Validation service temporarily unavailable. You can still submit — staff will verify manually.",
        });
        setIdValidated(false);
        setIdServerError(true);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setIdValidationMsg({ valid: false, message: errData.error || "Invalid file. Please try a different image." });
        setIdValidated(false);
        clearIdUploads();
        return;
      }

      const result = await res.json();
      const layers: string[] = result.layers || [];
      const keepForOtherSide =
        result.needsFrontSide
        || result.needsBackSide
        || layers.includes("front_missing")
        || layers.includes("address_missing");

      if (result.valid) {
        const staffReview = isStaffReviewValidation(result);
        setIdValidationMsg({ valid: true, staffReview, message: result.message });
        setIdValidated(true);
        setDetectedIdType(null);
        setSidePrompt(null);
      } else if (keepForOtherSide) {
        const prompt: "front" | "back" =
          result.needsFrontSide || layers.includes("front_missing") ? "front" : "back";
        setSidePrompt(prompt);
        setOfferOtherSide(false);
        setIdValidationMsg({ valid: false, message: result.message });
        setIdValidated(false);
        setDetectedIdType(null);
      } else if (layers.includes("type_mismatch") && result.documentType !== "unknown") {
        setIdValidationMsg({ valid: false, message: result.message });
        setIdValidated(false);
        setDetectedIdType(result.documentType);
      } else if (layers.some((l: string) => String(l).startsWith("unsupported_"))) {
        setIdValidationMsg({ valid: false, message: result.message });
        setIdValidated(false);
        setDetectedIdType(null);
        clearIdUploads();
      } else {
        // Remaining hard rejects (SafeSearch / label junk)
        setIdValidationMsg({ valid: false, message: result.message });
        setIdValidated(false);
        setDetectedIdType(null);
        clearIdUploads();
      }
    } catch {
      setIdValidationMsg({
        valid: false,
        staffReview: true,
        message: "Validation service temporarily unavailable. You can still submit — staff will verify manually.",
      });
      setIdValidated(false);
      setIdServerError(true);
    } finally {
      setValidatingId(false);
    }
  };

  const addVisaFile = (file: File) => {
    setPrevVisaLink("");
    setValue("prevVisaLink", undefined);

    appendDocFile(file, visaFiles, setVisaFiles, (next) => {
      setValue("visaImages", next.map((f) => f.file), { shouldValidate: true });
      setVisaValidationMsg(null);
    });
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
        setVisaValidationMsg({
          valid: false,
          staffReview: true,
          message: "Validation service temporarily unavailable. You can still submit — staff will verify manually.",
        });
        setVisaServerError(true);
        return;
      }

      const result = await res.json();
      const staffReview = isStaffReviewValidation(result);
      setVisaValidationMsg({ valid: !!result.valid, staffReview: result.valid && staffReview, message: result.message });

      if (!result.valid) {
        setVisaFiles([]);
        setValue("visaImages", null, { shouldValidate: true });
      }
    } catch {
      setVisaValidationMsg({
        valid: false,
        staffReview: true,
        message: "Validation service temporarily unavailable. You can still submit — staff will verify manually.",
      });
      setVisaServerError(true);
    } finally {
      setValidatingVisa(false);
    }
  };

  const onSubmit = async (data: CheckinFormData) => {
    setSubmitting(true);
    setSubmitError("");
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
      formData.append("idempotencyKey", idempotencyKey);

      if (idFiles.length > 0) {
        idFiles.forEach((doc) => {
          formData.append("idImages", doc.file);
        });
        if (idValidated && !idServerError && validationEnabled) {
          formData.append("clientIdValidation", "verified");
        }
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
        const errData = await res.json().catch(() => ({}));
        setSubmitError(messageFromCheckinFailure(422, errData));
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

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSubmitError(messageFromCheckinFailure(res.status, errData));
        return;
      }

      setSuccess(true);
      setIdempotencyKey(crypto.randomUUID());
      reset();
      setIdFrontFiles([]);
      setIdBackFiles([]);
      setSidePrompt(null);
      setOfferOtherSide(false);
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
    } catch (err) {
      setSubmitError(messageFromCheckinCatch(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "phone" && !success && !submitting) {
    return (
      <div className="goko-glass-panel mx-auto max-w-lg rounded-3xl p-6 shadow-card md:p-10">
        <h2 className="font-display text-2xl font-bold text-zinc-900 md:text-3xl">
          Guest Self Check-in
        </h2>
        <p className="mt-2 text-sm text-zinc-700">
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
            className="block w-full text-center text-sm text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Skip, I&apos;m a new guest
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="goko-glass-panel mx-auto max-w-lg rounded-3xl p-6 shadow-card md:p-10">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <CheckCircle2Icon className="h-8 w-8 text-brand-green-dark" />
          </div>
          <h2 className="mt-5 font-display text-2xl font-bold text-zinc-900">
            Check-in complete!
          </h2>
          <p className="mt-2 text-zinc-700">
            Your check-in was saved successfully. Welcome to Goko Hostel — enjoy your stay!
          </p>
        </div>

        {/* Property Rules */}
        <div className="mt-6 rounded-2xl bg-brand-sand/50 p-5">
          <h3 className="font-display text-base font-bold text-zinc-900">House Rules</h3>
          <div className="mt-3 space-y-2 text-sm text-zinc-700">
            <div className="flex gap-2"><span>🎒</span><p><strong>Solo Travelers & Small Groups (Max 4) Only.</strong> We don&apos;t accommodate large groups.</p></div>
            <div className="flex gap-2"><span>🎂</span><p><strong>Age Limit:</strong> 18 to 35 years only.</p></div>
            <div className="flex gap-2"><span>🌿</span><p><strong>Non-AC Property:</strong> We don&apos;t have air conditioning, but each bed has an individual fan.</p></div>
            <div className="flex gap-2"><span>🚶</span><p><strong>Parking & Access:</strong> Hostel is 300m from parking via a scenic trail. Backpacks recommended.</p></div>
            <div className="flex gap-2"><span>🚫</span><p><strong>Strictly No:</strong> Hard liquor, drugs, outside food & drinks.</p></div>
          </div>
          <div className="mt-4 flex gap-4 rounded-xl bg-white dark:bg-card p-3 text-sm">
            <div><strong className="text-zinc-900">Check-in:</strong> <span className="text-zinc-700">12:00 Noon</span></div>
            <div><strong className="text-zinc-900">Check-out:</strong> <span className="text-zinc-700">10:00 AM</span></div>
          </div>
          <p className="mt-3 text-xs text-zinc-600">
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
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            Submit another check-in
          </button>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div className="goko-glass-panel mx-auto max-w-2xl rounded-3xl p-12 text-center shadow-card md:p-16">
        <div className="mx-auto flex h-20 w-20 items-center justify-center">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-brand-green/20 border-t-brand-green" />
        </div>
        <h2 className="mt-8 font-display text-2xl font-bold text-zinc-900">
          Submitting your check-in...
        </h2>
        <p className="mt-3 text-zinc-700">
          Uploading documents and saving your details. Please wait and do not press the submit button again.
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
      className="goko-glass-panel mx-auto max-w-2xl rounded-3xl p-6 shadow-card md:p-10"
    >
      <h2 className="font-display text-2xl font-bold text-zinc-900 md:text-3xl">
        Guest Self Check-in
      </h2>
      <p className="mt-2 text-sm text-zinc-700">
        Please fill in your details. Fields marked with <span className="text-brand-red">*</span> are required.
      </p>

      {returnGuest && (
        <div className="goko-glass-chip mt-4 rounded-2xl border border-brand-green/30 p-4">
          <p className="text-sm font-medium text-zinc-900">
            Welcome back, {returnGuest.name}! We&apos;ve loaded your previous details. Please review and update if needed.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Booking</p>

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
          <div>
              <Label htmlFor="bookingId">Booking ID <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
              <Input
                id="bookingId"
                placeholder="e.g. 4829173650"
                {...register("bookingId")}
                className={cn(errors.bookingId && "border-brand-red")}
              />
              {errors.bookingId && (
                <p className="mt-1 text-xs text-brand-red">{errors.bookingId.message}</p>
              )}
          </div>
        </div>

        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Personal details</p>

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
          <Label htmlFor="nationality">Nationality <span className="text-brand-red">*</span></Label>
          <CountrySelect
            id="nationality"
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
            <div className="flex h-8 w-[5rem] shrink-0 items-center justify-center rounded-lg border border-input bg-brand-sand/50 px-2 text-sm font-medium text-zinc-900">
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
              <div className="flex h-8 w-[5rem] shrink-0 items-center justify-center rounded-lg border border-input bg-brand-sand/50 px-2 text-sm font-medium text-zinc-900">
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

        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">ID documents</p>

        {/* ID Type Selection */}
        <div>
          <Label htmlFor="idType">ID document type <span className="text-brand-red">*</span></Label>
          <select
            id="idType"
            {...register("idType")}
            onChange={(e) => {
              setValue("idType", e.target.value as any, { shouldValidate: true });
              setPrevIdCardLink("");
              setValue("prevIdCardLink", undefined);
              setIdValidated(false);
              setSidePrompt(null);
              setOfferOtherSide(false);
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
            <Label className="mb-2 block text-sm font-medium text-zinc-900">
              ID document (from previous visit)
            </Label>
            <div className="mb-2 flex flex-wrap gap-3">
              {prevIdCardLink.split(" | ").map((link, i) => {
                return (
                  <PreviousDocumentPreview
                    key={`${link}-${i}`}
                    link={link}
                    label="Previous ID"
                    index={i}
                    onRemove={() => {
                      const next = removeLinkFromJoined(prevIdCardLink, i);
                      setPrevIdCardLink(next);
                      setValue("prevIdCardLink", next || undefined);
                      if (!next) {
                        setIdValidated(false);
                        setIdValidationMsg(null);
                      }
                    }}
                  />
                );
              })}
            </div>
            <p className="text-xs text-zinc-600">
              Your previous ID is on file. Upload new documents below only if you want to replace them.
            </p>
            <button
              type="button"
              onClick={() => {
                setPrevIdCardLink("");
                setValue("prevIdCardLink", undefined);
                setIdValidated(false);
                setIdValidationMsg(null);
              }}
              className="mt-2 text-xs font-medium text-brand-green-dark underline-offset-2 hover:underline"
            >
              Clear previous ID and upload new
            </button>
          </div>
        )}

        {/* ID Upload — one primary slot; other side only after Verify asks (or guest opts in) */}
        <div className="space-y-4">
          <MultiDocUpload
            label={
              prevIdCardLink && idFiles.length === 0
                ? "Upload new ID (optional)"
                : isForeignNationality(nationality)
                  ? "Passport bio page *"
                  : idType === "driving_licence"
                    ? "Driving Licence *"
                    : idType === "aadhaar"
                      ? "Aadhaar document *"
                      : idType === "passport"
                        ? "Passport document *"
                        : "ID document *"
            }
            error={errors.idImages?.message as string | undefined}
            files={idFrontFiles}
            onAdd={addIdFrontFile}
            onRemove={removeIdFrontFile}
            onValidate={validationEnabled && !prevIdCardLink ? validateIdFiles : undefined}
            showValidate={idFiles.length > 0}
            validating={validatingId}
            validationMsg={validationEnabled && !showOtherSideSlot ? idValidationMsg : null}
            helpText={bothSidesHelpText(idType, nationality)}
          />

          {bothSidesCapable && !prevIdOnly && !showOtherSideSlot && idFrontFiles.length > 0 && (
            <button
              type="button"
              onClick={() => setOfferOtherSide(true)}
              className="text-xs font-medium text-brand-green-dark underline-offset-2 hover:underline"
            >
              Also upload the other side (optional)
            </button>
          )}

          {showOtherSideSlot && (
            <div className="space-y-2 rounded-2xl border border-amber-300/60 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-950/20">
              {sidePrompt && (
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {sidePrompt === "back"
                    ? "Address not found on your upload — please add the back / address side, then Verify again."
                    : "Front / bio page not found — please add the photo + DOB side, then Verify again."}
                </p>
              )}
              {!sidePrompt && offerOtherSide && (
                <p className="text-xs text-zinc-600">
                  Optional. Use this if name and address are on separate photos.
                </p>
              )}
              <MultiDocUpload
                label={
                  sidePrompt === "front"
                    ? (idType === "passport" ? "Bio page *" : "Front (photo + DOB) *")
                    : sidePrompt === "back"
                      ? (idType === "passport" ? "Address page *" : "Back (address) *")
                      : (idType === "passport" ? "Other page (optional)" : "Other side (optional)")
                }
                files={idBackFiles}
                onAdd={addIdBackFile}
                onRemove={removeIdBackFile}
                onValidate={validationEnabled && !prevIdCardLink ? validateIdFiles : undefined}
                showValidate={idFiles.length > 0}
                validating={validatingId}
                validationMsg={validationEnabled ? idValidationMsg : null}
                helpText="JPEG, PNG, WebP, PDF. Max 10 MB."
              />
            </div>
          )}
        </div>

        {/* Previous Visa preview for return guests */}
        {isForeignNationality(nationality) && prevVisaLink && visaFiles.length === 0 && (
          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-900">
              Visa document (from previous visit)
            </Label>
            <div className="mb-2 flex flex-wrap gap-3">
              {prevVisaLink.split(" | ").map((link, i) => {
                return (
                  <PreviousDocumentPreview
                    key={`${link}-${i}`}
                    link={link}
                    label="Previous visa"
                    index={i}
                    onRemove={() => {
                      const next = removeLinkFromJoined(prevVisaLink, i);
                      setPrevVisaLink(next);
                      setValue("prevVisaLink", next || undefined);
                      if (!next) setVisaValidationMsg(null);
                    }}
                  />
                );
              })}
            </div>
            <p className="text-xs text-zinc-600">
              Your previous visa is on file. Upload new documents below only if you want to replace them.
            </p>
            <button
              type="button"
              onClick={() => {
                setPrevVisaLink("");
                setValue("prevVisaLink", undefined);
                setVisaValidationMsg(null);
              }}
              className="mt-2 text-xs font-medium text-brand-green-dark underline-offset-2 hover:underline"
            >
              Clear previous visa and upload new
            </button>
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
            <p className="text-sm font-semibold text-zinc-900">Additional details for foreign nationals (required for Form C)</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="arrivedFromCountry">Arrived from country <span className="text-brand-red">*</span></Label>
                <CountrySelect
                  id="arrivedFromCountry"
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

      <div className="sticky bottom-0 z-10 -mx-6 mt-10 border-t border-brand-mist bg-white/95 px-6 py-4 backdrop-blur dark:bg-card/95 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        {submitError && (
          <p role="alert" className="mb-3 rounded-xl border border-brand-red/20 bg-brand-red/5 p-3 text-center text-sm text-brand-red">
            {submitError}
          </p>
        )}
        {validationLoaded && validationEnabled && !idValidated && !idServerError && idFiles.length > 0 && !prevIdCardLink && (
          <p className="mb-3 text-center text-sm text-brand-red">
            {sidePrompt
              ? "Add the requested side, then click \"Verify document\" again"
              : "Please click \"Verify document\" before submitting"}
          </p>
        )}
        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={
            submitting
            || !validationLoaded
            || (validationEnabled && !idValidated && !idServerError && !prevIdCardLink)
          }
        >
          {submitting ? "Submitting..." : !validationLoaded ? "Loading..." : "Complete Check-in"}
        </Button>
      </div>
    </form>
  );
}
