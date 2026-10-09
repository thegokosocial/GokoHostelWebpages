import { describe, expect, it } from "vitest";
import { checkinReviewReasons } from "@/lib/checkinReview";

describe("checkin review reasons", () => {
  it("matches every unresolved Vibe? condition", () => {
    const year = new Date().getFullYear();
    expect(checkinReviewReasons({
      dob: `01/01/${year - 17}`, dobFromId: `02/01/${year - 17}`, verified: "doc_review", minAge: 18, maxAge: 40,
    }).map((reason) => reason.label)).toEqual(["Underage (17)", "DOB mismatch", "Document check"]);
  });

  it("handles name review and age boundaries without flagging clear or resolved records", () => {
    const year = new Date().getFullYear();
    expect(checkinReviewReasons({ dob: `01/01/${year - 40}`, verified: "name_review", minAge: 18, maxAge: 40 }).map((reason) => reason.label))
      .toEqual(["Name check"]);
    expect(checkinReviewReasons({ dob: `01/01/${year - 41}`, minAge: 18, maxAge: 40 }).map((reason) => reason.label))
      .toEqual(["Overage (41)"]);
    expect(checkinReviewReasons({ dob: "2000-01-01", verified: "pending", minAge: 18, maxAge: 40 })).toEqual([]);
    expect(checkinReviewReasons({ dob: "2000-01-01", verified: "doc_review", vibeMatched: 1 })).toEqual([]);
  });
});
