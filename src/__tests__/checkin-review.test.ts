import { describe, expect, it } from "vitest";
import { checkinReviewReasons, getCheckinReviewState } from "@/lib/checkinReview";

describe("checkin review reasons", () => {
  it("matches every unresolved Vibe? condition", () => {
    const year = new Date().getFullYear();
    expect(checkinReviewReasons({
      dob: `01/01/${year - 17}`, dobFromId: `02/01/${year - 17}`, verified: "doc_review", minAge: 18, maxAge: 40,
    }).map((reason) => reason.label)).toEqual(["Underage (17)", "DOB mismatch", "Document check"]);
  });

  it("uses only the ID DOB for age flags while preserving other review reasons", () => {
    const year = new Date().getFullYear();
    expect(checkinReviewReasons({ dob: `01/01/${year - 17}`, verified: "name_review", minAge: 18, maxAge: 40 }).map((reason) => reason.label))
      .toEqual(["Name check"]);
    expect(checkinReviewReasons({ dob: "31/04/2000", dobFromId: `01/01/${year - 17}`, minAge: 18, maxAge: 40 }).map((reason) => reason.label))
      .toEqual(["Underage (17)"]);
    expect(checkinReviewReasons({ dobFromId: `01/01/${year - 41}`, minAge: 18, maxAge: 40 }).map((reason) => reason.label))
      .toEqual(["Overage (41)"]);
    expect(checkinReviewReasons({ dob: "2000-01-01", verified: "pending", minAge: 18, maxAge: 40 })).toEqual([]);
    expect(checkinReviewReasons({ dob: "2000-01-01", verified: "doc_review", vibeMatched: 1 })).toEqual([]);
  });

  it("keeps accepted Vibe reasons visible as green-safe labels without changing unresolved behavior", () => {
    const year = new Date().getFullYear();
    const accepted = getCheckinReviewState({
      dob: `01/01/${year - 17}`, dobFromId: `02/01/${year - 17}`, verified: "name_review", vibeMatched: 1, minAge: 18, maxAge: 40,
    });
    expect(accepted.unresolved).toEqual([]);
    expect(accepted.accepted.map((reason) => reason.label)).toEqual(["Underage check OK", "DOB check OK", "Name check OK"]);
    expect(getCheckinReviewState({ verified: "spoof_warning", vibeMatched: 1 }).accepted).toEqual([]);
  });
});
