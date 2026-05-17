"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useRef, useCallback } from "react";
import { checkinSchema, type CheckinFormData } from "@/lib/checkinSchema";
import { countries } from "@/content/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  const date = now.toISOString().split("T")[0];
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
        className={cn(error && "border-red-400 ring-red-100")}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-brand-mist bg-white shadow-lift">
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

type ImageFile = { file: File; preview: string };

function MultiImageUpload({
  label,
  error,
  images,
  onAdd,
  onRemove,
  helpText,
}: {
  label: string;
  error?: string;
  images: ImageFile[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  helpText?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.size <= 10 * 1024 * 1024) onAdd(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  return (
    <div>
      <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
        {label}
      </Label>

      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.preview}
                alt={`Document ${i + 1}`}
                className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md"
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
          {images.length > 0 ? "Add more" : "Upload file"}
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <p className="mt-1.5 text-xs text-brand-green-dark/50">
        {helpText || "Upload front & back. Max 10 MB per image."}
      </p>
    </div>
  );
}

export function SelfCheckinForm() {
  const { date, time } = getNow();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [idImages, setIdImages] = useState<ImageFile[]>([]);
  const [visaImages, setVisaImages] = useState<ImageFile[]>([]);

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
      arrivalDate: date,
      arrivalTime: time,
      name: "",
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

  const addIdImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const newImages = [...idImages, { file, preview: e.target?.result as string }];
      setIdImages(newImages);
      setValue("idImages", newImages.map((img) => img.file), { shouldValidate: true });
    };
    reader.readAsDataURL(file);
  };

  const removeIdImage = (index: number) => {
    const newImages = idImages.filter((_, i) => i !== index);
    setIdImages(newImages);
    setValue("idImages", newImages.length > 0 ? newImages.map((img) => img.file) : null, { shouldValidate: true });
  };

  const addVisaImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const newImages = [...visaImages, { file, preview: e.target?.result as string }];
      setVisaImages(newImages);
      setValue("visaImages", newImages.map((img) => img.file), { shouldValidate: true });
    };
    reader.readAsDataURL(file);
  };

  const removeVisaImage = (index: number) => {
    const newImages = visaImages.filter((_, i) => i !== index);
    setVisaImages(newImages);
    setValue("visaImages", newImages.length > 0 ? newImages.map((img) => img.file) : null, { shouldValidate: true });
  };

  const onSubmit = async (data: CheckinFormData) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("arrivalDate", data.arrivalDate);
      formData.append("arrivalTime", data.arrivalTime);
      formData.append("name", data.name);
      formData.append("numberOfPersons", data.numberOfPersons);
      formData.append("contactNumber", data.contactNumber);
      formData.append("stayingDays", data.stayingDays);
      formData.append("comingFrom", data.comingFrom);
      formData.append("nationality", data.nationality);
      formData.append("emergencyName", data.emergencyName);
      formData.append("emergencyPhone", data.emergencyPhone);
      formData.append("idType", data.idType);

      idImages.forEach((img) => {
        formData.append("idImages", img.file);
      });

      visaImages.forEach((img) => {
        formData.append("visaImages", img.file);
      });

      const res = await fetch("/api/checkin", {
        method: "POST",
        body: formData,
      });

      if (res.status === 422) {
        const errData = await res.json();
        alert(errData.error || "Document validation failed. Please upload a valid ID.");
        return;
      }

      if (!res.ok) throw new Error("Submission failed");

      setSuccess(true);
      reset();
      setIdImages([]);
      setVisaImages([]);
    } catch {
      alert("Something went wrong. Please try again or contact the front desk.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-brand-mist bg-white p-8 text-center shadow-card md:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
          <CheckCircle2Icon className="h-8 w-8 text-brand-green" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-brand-green">
          Check-in complete!
        </h2>
        <p className="mt-3 text-brand-green-dark/80">
          Welcome to Goko Hostel. Our team has been notified. Enjoy your stay!
        </p>
        <Button
          type="button"
          variant="ctaOutline"
          className="mt-8"
          onClick={() => setSuccess(false)}
        >
          Submit another check-in
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mx-auto max-w-2xl rounded-3xl border border-brand-mist bg-white p-6 shadow-card md:p-10"
    >
      <h2 className="font-display text-2xl font-bold text-brand-green md:text-3xl">
        Guest Self Check-in
      </h2>
      <p className="mt-2 text-sm text-brand-green-dark/70">
        Please fill in your details. All fields are required.
      </p>

      <div className="mt-8 space-y-6">
        {/* Date & Time */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="arrivalDate">Date of arrival</Label>
            <Input
              id="arrivalDate"
              type="date"
              {...register("arrivalDate")}
              className={cn(errors.arrivalDate && "border-red-400")}
            />
            {errors.arrivalDate && (
              <p className="mt-1 text-xs text-red-500">{errors.arrivalDate.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="arrivalTime">Time of arrival</Label>
            <Input
              id="arrivalTime"
              type="time"
              {...register("arrivalTime")}
              className={cn(errors.arrivalTime && "border-red-400")}
            />
            {errors.arrivalTime && (
              <p className="mt-1 text-xs text-red-500">{errors.arrivalTime.message}</p>
            )}
          </div>
        </div>

        {/* Name */}
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            placeholder="Enter your full name"
            {...register("name")}
            className={cn(errors.name && "border-red-400")}
            autoComplete="name"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
          )}
        </div>

        {/* Number of persons & Staying days */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="numberOfPersons">Number of persons</Label>
            <Input
              id="numberOfPersons"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 2"
              {...register("numberOfPersons")}
              className={cn(errors.numberOfPersons && "border-red-400")}
            />
            {errors.numberOfPersons && (
              <p className="mt-1 text-xs text-red-500">
                {errors.numberOfPersons.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="stayingDays">Staying number of days</Label>
            <Input
              id="stayingDays"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 3"
              {...register("stayingDays")}
              className={cn(errors.stayingDays && "border-red-400")}
            />
            {errors.stayingDays && (
              <p className="mt-1 text-xs text-red-500">{errors.stayingDays.message}</p>
            )}
          </div>
        </div>

        {/* Nationality */}
        <div>
          <Label>Nationality</Label>
          <CountrySelect
            value={nationality}
            onChange={(val) => setValue("nationality", val, { shouldValidate: true })}
            error={errors.nationality?.message}
          />
          {errors.nationality && (
            <p className="mt-1 text-xs text-red-500">{errors.nationality.message}</p>
          )}
        </div>

        {/* Coming from */}
        <div>
          <Label htmlFor="comingFrom">Coming from (city/place)</Label>
          <Input
            id="comingFrom"
            placeholder="e.g. Mumbai"
            {...register("comingFrom")}
            className={cn(errors.comingFrom && "border-red-400")}
          />
          {errors.comingFrom && (
            <p className="mt-1 text-xs text-red-500">{errors.comingFrom.message}</p>
          )}
        </div>

        {/* Contact number */}
        <div>
          <Label htmlFor="contactNumber">Contact number</Label>
          <div className="flex gap-2">
            <div className="flex h-9 w-[5rem] shrink-0 items-center justify-center rounded-md border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
              {countryDialCodes[nationality] || "+91"}
            </div>
            <Input
              id="contactNumber"
              type="tel"
              inputMode="tel"
              placeholder="98765 43210"
              {...register("contactNumber")}
              className={cn("flex-1", errors.contactNumber && "border-red-400")}
              autoComplete="tel"
            />
          </div>
          {errors.contactNumber && (
            <p className="mt-1 text-xs text-red-500">{errors.contactNumber.message}</p>
          )}
        </div>

        {/* Emergency contact */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="emergencyName">Emergency contact name</Label>
            <Input
              id="emergencyName"
              placeholder="e.g. Parent or friend"
              {...register("emergencyName")}
              className={cn(errors.emergencyName && "border-red-400")}
            />
            {errors.emergencyName && (
              <p className="mt-1 text-xs text-red-500">{errors.emergencyName.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="emergencyPhone">Emergency contact phone</Label>
            <div className="flex gap-2">
              <div className="flex h-9 w-[5rem] shrink-0 items-center justify-center rounded-md border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
                {countryDialCodes[nationality] || "+91"}
              </div>
              <Input
                id="emergencyPhone"
                type="tel"
                inputMode="tel"
                placeholder="98765 43210"
                {...register("emergencyPhone")}
                className={cn("flex-1", errors.emergencyPhone && "border-red-400")}
              />
            </div>
            {errors.emergencyPhone && (
              <p className="mt-1 text-xs text-red-500">{errors.emergencyPhone.message}</p>
            )}
          </div>
        </div>

        {/* ID Type Selection */}
        <div>
          <Label htmlFor="idType">ID document type</Label>
          <select
            id="idType"
            {...register("idType")}
            className={cn(
              "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring",
              errors.idType && "border-red-400"
            )}
          >
            <option value="">Select ID type...</option>
            <option value="aadhaar">Aadhaar Card</option>
            <option value="driving_licence">Driving Licence</option>
            <option value="passport">Passport</option>
          </select>
          {errors.idType && (
            <p className="mt-1 text-xs text-red-500">{errors.idType.message}</p>
          )}
        </div>

        {/* ID Images Upload (multiple) */}
        <MultiImageUpload
          label="ID photos (upload front & back)"
          error={errors.idImages?.message as string | undefined}
          images={idImages}
          onAdd={addIdImage}
          onRemove={removeIdImage}
          helpText="Upload front and back of your ID. Max 10 MB per image."
        />

        {/* Visa (conditional, multiple) */}
        {nationality && nationality !== "India" && (
          <MultiImageUpload
            label="Visa document photos (required for non-Indian nationals)"
            error={errors.visaImages?.message as string | undefined}
            images={visaImages}
            onAdd={addVisaImage}
            onRemove={removeVisaImage}
            helpText="Upload all relevant visa pages. Max 10 MB per image."
          />
        )}
      </div>

      <div className="mt-10">
        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Complete Check-in"}
        </Button>
      </div>
    </form>
  );
}
