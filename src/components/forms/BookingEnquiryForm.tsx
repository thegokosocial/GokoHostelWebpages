"use client";

import { useState } from "react";
import { z } from "zod";
import { site } from "@/lib/site";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  email: z.string().trim().email("Valid email required"),
  phone: z.string().trim().min(8, "Phone number required"),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guests: z.string().optional(),
  message: z.string().trim().min(10, "Tell us a bit more (10+ characters)"),
});

type FormState = z.infer<typeof schema>;

const initial: FormState = {
  name: "",
  email: "",
  phone: "",
  checkIn: "",
  checkOut: "",
  guests: "",
  message: "",
};

const fieldCls =
  "mt-1 w-full rounded-xl border border-brand-green/20 bg-white px-4 py-3 text-brand-green-dark placeholder:text-brand-green/40 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/25 min-h-11";

export function BookingEnquiryForm() {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>(
    {}
  );
  const [submitted, setSubmitted] = useState<"whatsapp" | "email" | null>(null);

  function validate(): FormState | null {
    const r = schema.safeParse(values);
    if (r.success) {
      setErrors({});
      return r.data;
    }
    const next: Partial<Record<keyof FormState, string>> = {};
    const flat = r.error.flatten().fieldErrors;
    (Object.keys(flat) as (keyof FormState)[]).forEach((k) => {
      const msgs = flat[k];
      if (msgs?.[0]) next[k] = msgs[0];
    });
    setErrors(next);
    return null;
  }

  function buildBody(data: FormState) {
    const lines = [
      `Booking enquiry — ${site.shortName}`,
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Phone: ${data.phone}`,
    ];
    if (data.checkIn) lines.push(`Check-in: ${data.checkIn}`);
    if (data.checkOut) lines.push(`Check-out: ${data.checkOut}`);
    if (data.guests) lines.push(`Guests: ${data.guests}`);
    lines.push("", data.message);
    return lines.join("\n");
  }

  function openWhatsApp() {
    const data = validate();
    if (!data) return;
    const text = encodeURIComponent(buildBody(data));
    window.open(`${site.whatsAppUrl}?text=${text}`, "_blank", "noopener,noreferrer");
    setSubmitted("whatsapp");
  }

  function sendEmail() {
    const data = validate();
    if (!data) return;
    const body = encodeURIComponent(buildBody(data));
    const subject = encodeURIComponent(`Booking enquiry — ${data.name}`);
    window.location.href = `mailto:${site.contactEmail}?subject=${subject}&body=${body}`;
    setSubmitted("email");
  }

  function set<K extends keyof FormState>(key: K, v: FormState[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSubmitted(null);
  }

  return (
    <form
      className="mx-auto max-w-xl space-y-5 rounded-3xl border border-brand-mist bg-white p-6 shadow-card md:p-8"
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      <div>
        <label className="text-sm font-medium text-brand-green" htmlFor="enq-name">
          Name
        </label>
        <input
          id="enq-name"
          className={cn(fieldCls, errors.name && "border-brand-red")}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          autoComplete="name"
          required
        />
        {errors.name ? (
          <p className="mt-1 text-sm text-brand-red">{errors.name}</p>
        ) : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium text-brand-green" htmlFor="enq-email">
            Email
          </label>
          <input
            id="enq-email"
            type="email"
            className={cn(fieldCls, errors.email && "border-brand-red")}
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            autoComplete="email"
          />
          {errors.email ? (
            <p className="mt-1 text-sm text-brand-red">{errors.email}</p>
          ) : null}
        </div>
        <div>
          <label className="text-sm font-medium text-brand-green" htmlFor="enq-phone">
            Phone
          </label>
          <input
            id="enq-phone"
            type="tel"
            className={cn(fieldCls, errors.phone && "border-brand-red")}
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            autoComplete="tel"
          />
          {errors.phone ? (
            <p className="mt-1 text-sm text-brand-red">{errors.phone}</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label className="text-sm font-medium text-brand-green" htmlFor="enq-in">
            Check-in
          </label>
          <input
            id="enq-in"
            type="date"
            className={fieldCls}
            value={values.checkIn}
            onChange={(e) => set("checkIn", e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-brand-green" htmlFor="enq-out">
            Check-out
          </label>
          <input
            id="enq-out"
            type="date"
            className={fieldCls}
            value={values.checkOut}
            onChange={(e) => set("checkOut", e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-brand-green" htmlFor="enq-guests">
            Guests
          </label>
          <input
            id="enq-guests"
            className={fieldCls}
            inputMode="numeric"
            placeholder="e.g. 2"
            value={values.guests}
            onChange={(e) => set("guests", e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-brand-green" htmlFor="enq-msg">
          Message
        </label>
        <textarea
          id="enq-msg"
          rows={5}
          className={cn(fieldCls, "min-h-[140px] resize-y", errors.message && "border-brand-red")}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          placeholder="Dates flexible? Room type? Special requests?"
        />
        {errors.message ? (
          <p className="mt-1 text-sm text-brand-red">{errors.message}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" className="flex-1" onClick={openWhatsApp}>
          Send via WhatsApp
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={sendEmail}
        >
          Open email draft
        </Button>
      </div>
      {submitted ? (
        <p className="text-center text-sm text-brand-green-dark/80" role="status">
          {submitted === "whatsapp"
            ? "If WhatsApp did not open, check your pop-up settings."
            : "Your mail app should open with a pre-filled message."}
        </p>
      ) : null}
    </form>
  );
}
