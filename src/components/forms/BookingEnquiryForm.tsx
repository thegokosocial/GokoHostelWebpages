"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { site } from "@/lib/site";
import { bookingEnquirySchema, formatBookingEnquiryBody, type BookingEnquiryPayload } from "@/lib/bookingEnquiry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";

export function BookingEnquiryForm() {
  const form = useForm<BookingEnquiryPayload>({
    resolver: zodResolver(bookingEnquirySchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      checkIn: "",
      checkOut: "",
      guests: "",
      message: "",
      _hp: "",
    },
  });

  const [submitted, setSubmitted] = useState<"whatsapp" | "email" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function openWhatsApp() {
    void form.handleSubmit((data) => {
      const text = encodeURIComponent(formatBookingEnquiryBody(data));
      window.open(`${site.whatsAppUrl}?text=${text}`, "_blank", "noopener,noreferrer");
      setSubmitted("whatsapp");
      setSubmitError(null);
    })();
  }

  function sendEnquiry() {
    void form.handleSubmit(async (data) => {
      setSubmitted(null);
      setSubmitError(null);
      setSending(true);
      try {
        const res = await fetch("/api/booking-enquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setSubmitError(json.error ?? "Could not send enquiry. Try WhatsApp instead.");
          return;
        }
        setSubmitted("email");
        form.reset();
      } catch {
        setSubmitError("Could not send enquiry. Try WhatsApp instead.");
      } finally {
        setSending(false);
      }
    })();
  }

  const fieldRing = "rounded-xl border border-brand-green/20 bg-white min-h-11 px-4 py-3 text-base text-brand-green-dark md:text-sm";

  return (
    <form
      className="mx-auto max-w-xl space-y-5 rounded-3xl border border-brand-mist bg-white p-6 shadow-card md:p-8"
      onSubmit={(e) => e.preventDefault()}
    >
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        {...form.register("_hp")}
      />
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
      <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="enq-in" className="text-brand-green">
            Check-in
          </Label>
          <Input
            id="enq-in"
            type="date"
            min={todayIST()}
            className={fieldRing}
            {...form.register("checkIn", {
              onChange: (e) => {
                if (e.target.value) form.setValue("checkOut", addCalendarDays(e.target.value, 1));
              },
            })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enq-out" className="text-brand-green">
            Check-out
          </Label>
          <Input
            id="enq-out"
            type="date"
            min={form.watch("checkIn") ? addCalendarDays(form.watch("checkIn")!, 1) : todayIST()}
            className={fieldRing}
            {...form.register("checkOut")}
          />
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
            setSubmitError(null);
            openWhatsApp();
          }}
        >
          Send via WhatsApp
        </Button>
        <Button
          type="button"
          variant="ctaOutline"
          className="flex-1"
          disabled={sending}
          onClick={sendEnquiry}
        >
          {sending ? "Sending…" : "Send enquiry"}
        </Button>
      </div>
      {submitError ? (
        <p className="text-center text-sm text-brand-red" role="alert">
          {submitError}
        </p>
      ) : null}
      {submitted ? (
        <p className="text-center text-sm text-brand-green-dark/80" role="status">
          {submitted === "whatsapp"
            ? "If WhatsApp did not open, check your pop-up settings."
            : "Thanks — we received your enquiry and sent a confirmation to your email."}
        </p>
      ) : null}
    </form>
  );
}
