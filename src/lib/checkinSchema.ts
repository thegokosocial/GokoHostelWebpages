import { z } from "zod";

const nameChars = /^[A-Za-z\s'.\u00C0-\u024F-]+$/;
const placeChars = /^[A-Za-z\s'.,\u00C0-\u024F-]+$/;
const numbersOnly = /^\d+$/;
const phoneRegex = /^\+?[\d\s\-]{10,18}$/;

export const BOOKING_PLATFORMS = [
  "Booking.com", "Agoda", "MakeMyTrip", "Hostelworld", "Airbnb", "Offline booking", "Walk-in",
] as const;

export type BookingPlatform = (typeof BOOKING_PLATFORMS)[number];

export function isForeignNationality(nationality: string | null | undefined): boolean {
  return Boolean(nationality?.trim() && nationality.trim().toLowerCase() !== "india");
}

export const checkinSchema = z
  .object({
    bookingPlatform: z.enum(BOOKING_PLATFORMS, {
      required_error: "Please select a booking platform",
    }),
    bookingId: z.string().optional(),
    arrivalDate: z.string().min(1, "Arrival date is required"),
    arrivalTime: z.string().min(1, "Arrival time is required"),
    firstName: z
      .string()
      .min(2, "First name must be at least 2 characters")
      .max(50, "First name is too long")
      .regex(nameChars, "Only letters, spaces, hyphens, and apostrophes allowed"),
    lastName: z
      .string()
      .min(2, "Last name must be at least 2 characters")
      .max(50, "Last name is too long")
      .regex(nameChars, "Only letters, spaces, hyphens, and apostrophes allowed"),
    numberOfPersons: z
      .string()
      .min(1, "Number of persons is required")
      .regex(numbersOnly, "Only numbers allowed"),
    contactNumber: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .regex(phoneRegex, "Enter a valid phone number")
      .refine((v) => (v.match(/\d/g) || []).length >= 7, "Phone must contain at least 7 digits"),
    stayingDays: z
      .string()
      .min(1, "Number of days is required")
      .regex(numbersOnly, "Only numbers allowed"),
    comingFrom: z
      .string()
      .min(2, "City/place is required")
      .regex(placeChars, "Only letters, spaces, hyphens, and periods allowed"),
    nationality: z.string().min(1, "Nationality is required"),
    emergencyName: z
      .string()
      .min(2, "Emergency contact name is required")
      .regex(nameChars, "Only letters, spaces, hyphens, and apostrophes allowed"),
    emergencyPhone: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .regex(phoneRegex, "Enter a valid phone number")
      .refine((v) => (v.match(/\d/g) || []).length >= 7, "Phone must contain at least 7 digits"),
    dob: z.string().optional(),
    idType: z.enum(["aadhaar", "driving_licence", "passport"], {
      required_error: "Please select your ID type",
    }),
    idImages: z
      .any()
      .refine(
        (files) => files && files.length > 0,
        "At least one ID image is required"
      )
      .refine(
        (files) =>
          !files || Array.from(files as File[]).every((f) => f.size <= 10 * 1024 * 1024),
        "Each file must be less than 10 MB"
      )
      .optional(),
    visaImages: z.any().optional(),
    prevIdCardLink: z.string().optional(),
    prevVisaLink: z.string().optional(),
    arrivedFromCountry: z.string().optional(),
    arrivedFromCity: z.string().optional(),
    arrivedFromPlace: z.string().optional(),
    dateOfArrivalInIndia: z.string().optional(),
    purposeOfVisit: z.string().optional(),
    employedInIndia: z.string().optional(),
    nextDestination: z.string().optional(),
    nextDestState: z.string().optional(),
    nextDestCity: z.string().optional(),
    nextDestPlace: z.string().optional(),
    homeAddress: z.string().optional(),
    homeCity: z.string().optional(),
    homeCountryPhone: z.string().optional(),
  })
  .refine(
    (data) => !isForeignNationality(data.nationality) || data.idType === "passport",
    {
      message: "Foreign nationals must provide a passport",
      path: ["idType"],
    }
  )
  .refine(
    (data) => {
      if (data.prevIdCardLink) return true;
      return data.idImages && data.idImages.length > 0;
    },
    {
      message: "At least one ID image is required",
      path: ["idImages"],
    }
  )
  .refine(
    (data) => {
      if (isForeignNationality(data.nationality)) {
        if (data.prevVisaLink) return true;
        return data.visaImages && data.visaImages.length > 0;
      }
      return true;
    },
    {
      message: "Visa document is required for non-Indian nationals",
      path: ["visaImages"],
    }
  )
  .refine(
    (data) => {
      if (isForeignNationality(data.nationality)) {
        return !!data.arrivedFromCountry;
      }
      return true;
    },
    {
      message: "Arrival country is required for foreign nationals",
      path: ["arrivedFromCountry"],
    }
  )
  .refine(
    (data) => {
      if (isForeignNationality(data.nationality)) {
        return !!data.purposeOfVisit;
      }
      return true;
    },
    {
      message: "Purpose of visit is required for foreign nationals",
      path: ["purposeOfVisit"],
    }
  )
  .refine(
    (data) => {
      if (data.contactNumber && data.emergencyPhone) {
        const personal = data.contactNumber.replace(/[\s+\-]/g, "");
        const emergency = data.emergencyPhone.replace(/[\s+\-]/g, "");
        return personal !== emergency;
      }
      return true;
    },
    {
      message: "Emergency contact must be different from your personal number",
      path: ["emergencyPhone"],
    }
  )
  .refine(
    (data) => {
      if (
        data.bookingPlatform &&
        data.bookingPlatform !== "Offline booking" &&
        data.bookingPlatform !== "Walk-in"
      ) {
        return !!data.bookingId && data.bookingId.trim().length > 0;
      }
      return true;
    },
    {
      message: "Booking ID is required for this platform",
      path: ["bookingId"],
    }
  );

export type CheckinFormData = z.infer<typeof checkinSchema>;
