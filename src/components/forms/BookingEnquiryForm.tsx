"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { site } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export function BookingEnquiryForm() {
  const form = useForm<FormState>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      checkIn: "",
      checkOut: "",
      guests: "",
      message: "",
    },
  });

  const [submitted, setSubmitted] = useState<"whatsapp" | "email" | null>(null);

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
    void form.handleSubmit((data) => {
      const text = encodeURIComponent(buildBody(data));
      window.open(`${site.whatsAppUrl}?text=${text}`, "_blank", "noopener,noreferrer");
      setSubmitted("whatsapp");
    })();
  }

  function sendEmail() {
    void form.handleSubmit((data) => {
      const body = encodeURIComponent(buildBody(data));
      const subject = encodeURIComponent(`Booking enquiry — ${data.name}`);
      window.location.href = `mailto:${site.contactEmail}?subject=${subject}&body=${body}`;
      setSubmitted("email");
    })();
  }

  const fieldRing = "rounded-xl border border-brand-green/20 bg-white min-h-11 px-4 py-3 text-base text-brand-green-dark md:text-sm";

  return (
    <form
      className="mx-auto max-w-xl space-y-5 rounded-3xl border border-brand-mist bg-white p-6 shadow-card md:p-8"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="space-y-2">
        <Label htmlFor="enq-name" className="text-brand-green">
          Name
        </Label>
        <Input
          id="enq-name"
          className={cn(fieldRing, form.formState.errors.name && "border-brand-red")}
          autoComplete="name"
          {...form.register("name")}
        />
        {form.formState.errors.name ? (
          <p className="text-sm text-brand-red">{form.formState.errors.name.message}</p>
        ) : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="enq-email" className="text-brand-green">
            Email
          </Label>
          <Input
            id="enq-email"
            type="email"
            className={cn(fieldRing, form.formState.errors.email && "border-brand-red")}
            autoComplete="email"
            {...form.register("email")}
          />
          {form.formState.errors.email ? (
            <p className="text-sm text-brand-red">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="enq-phone" className="text-brand-green">
            Phone
          </Label>
          <Input
            id="enq-phone"
            type="tel"
            className={cn(fieldRing, form.formState.errors.phone && "border-brand-red")}
            autoComplete="tel"
            {...form.register("phone")}
          />
          {form.formState.errors.phone ? (
            <p className="text-sm text-brand-red">{form.formState.errors.phone.message}</p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="enq-in" className="text-brand-green">
            Check-in
          </Label>
          <Input id="enq-in" type="date" className={fieldRing} {...form.register("checkIn")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enq-out" className="text-brand-green">
            Check-out
          </Label>
          <Input id="enq-out" type="date" className={fieldRing} {...form.register("checkOut")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enq-guests" className="text-brand-green">
            Guests
          </Label>
          <Input
            id="enq-guests"
            inputMode="numeric"
            placeholder="e.g. 2"
            className={fieldRing}
            {...form.register("guests")}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="enq-msg" className="text-brand-green">
          Message
        </Label>
        <Textarea
          id="enq-msg"
          rows={5}
          placeholder="Dates flexible? Room type? Special requests?"
          className={cn(
            fieldRing,
            "min-h-[140px] resize-y py-3",
            form.formState.errors.message && "border-brand-red"
          )}
          {...form.register("message")}
        />
        {form.formState.errors.message ? (
          <p className="text-sm text-brand-red">{form.formState.errors.message.message}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="cta"
          className="flex-1"
          onClick={() => {
            setSubmitted(null);
            openWhatsApp();
          }}
        >
          Send via WhatsApp
        </Button>
        <Button
          type="button"
          variant="ctaOutline"
          className="flex-1"
          onClick={() => {
            setSubmitted(null);
            sendEmail();
          }}
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
