import { z } from "zod";

const alphabetsOnly = /^[A-Za-z\s]+$/;
const numbersOnly = /^\d+$/;
const phoneRegex = /^\+?\d{10,15}$/;

export const checkinSchema = z
  .object({
    arrivalDate: z.string().min(1, "Arrival date is required"),
    arrivalTime: z.string().min(1, "Arrival time is required"),
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name is too long")
      .regex(alphabetsOnly, "Only letters and spaces allowed"),
    numberOfPersons: z
      .string()
      .min(1, "Number of persons is required")
      .regex(numbersOnly, "Only numbers allowed"),
    contactNumber: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .regex(phoneRegex, "Enter a valid phone number (10-15 digits, optional + prefix)"),
    stayingDays: z
      .string()
      .min(1, "Number of days is required")
      .regex(numbersOnly, "Only numbers allowed"),
    comingFrom: z
      .string()
      .min(2, "City/place is required")
      .regex(alphabetsOnly, "Only letters and spaces allowed"),
    nationality: z.string().min(1, "Nationality is required"),
    emergencyName: z
      .string()
      .min(2, "Emergency contact name is required")
      .regex(alphabetsOnly, "Only letters and spaces allowed"),
    emergencyPhone: z
      .string()
      .min(10, "Phone number must be at least 10 digits")
      .regex(phoneRegex, "Enter a valid phone number"),
    idCardImage: z
      .any()
      .refine(
        (files) => files && files.length > 0,
        "ID card image is required"
      )
      .refine(
        (files) =>
          !files ||
          files.length === 0 ||
          files[0].size <= 10 * 1024 * 1024,
        "File must be less than 10 MB"
      ),
    visaImage: z.any().optional(),
  })
  .refine(
    (data) => {
      if (data.nationality && data.nationality !== "India") {
        return data.visaImage && data.visaImage.length > 0;
      }
      return true;
    },
    {
      message: "Visa document is required for non-Indian nationals",
      path: ["visaImage"],
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
  );

export type CheckinFormData = z.infer<typeof checkinSchema>;
