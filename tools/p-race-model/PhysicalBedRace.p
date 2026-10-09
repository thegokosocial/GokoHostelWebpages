// Two staff actions compete for one physical bed. The target claim must be conditional.
type tClaim = (source: machine, guest: int);
event eClaimBed: tClaim; event eOccupiedBy: int;

machine UnsafePhysicalBed {
  var occupant: int;
  start state Available {
    on eClaimBed do (claim: tClaim) {
      occupant = claim.guest;
      announce eOccupiedBy, occupant;
    }
  }
}

machine ClaimedPhysicalBed {
  var occupied: bool;
  var occupant: int;
  start state Available {
    on eClaimBed do (claim: tClaim) {
      if (!occupied) {
        occupied = true;
        occupant = claim.guest;
        announce eOccupiedBy, occupant;
      }
    }
  }
}

machine BedClaimant {
  start state Claim { entry (input: (bed: machine, guest: int)) { send input.bed, eClaimBed, (source = this, guest = input.guest); } }
}

spec BedClaimedOnce observes eOccupiedBy {
  var claims: int;
  start state Watch { on eOccupiedBy do (guest: int) { claims = claims + 1; assert claims <= 1, "two guests claimed one physical bed"; } }
}

machine TestUnsafePhysicalBed { start state Init { entry { var bed: UnsafePhysicalBed; bed = new UnsafePhysicalBed(); new BedClaimant((bed = bed, guest = 1)); new BedClaimant((bed = bed, guest = 2)); } } }
machine TestClaimedPhysicalBed { start state Init { entry { var bed: ClaimedPhysicalBed; bed = new ClaimedPhysicalBed(); new BedClaimant((bed = bed, guest = 1)); new BedClaimant((bed = bed, guest = 2)); } } }
module UnsafePhysicalBedModel = { UnsafePhysicalBed }; module ClaimedPhysicalBedModel = { ClaimedPhysicalBed }; module BedClaimantModel = { BedClaimant };
test tcClaimedPhysicalBed [main=TestClaimedPhysicalBed]: assert BedClaimedOnce in (union ClaimedPhysicalBedModel, BedClaimantModel, { TestClaimedPhysicalBed });
test tcUnsafePhysicalBed [main=TestUnsafePhysicalBed]: assert BedClaimedOnce in (union UnsafePhysicalBedModel, BedClaimantModel, { TestUnsafePhysicalBed });
