// Retry submissions with one idempotency key must not cause multiple document uploads.
event eSubmitCheckin: machine; event eUploadCount: int;
machine UnsafeCheckinService { var uploads: int; start state Open { on eSubmitCheckin do (source: machine) { uploads = uploads + 1; announce eUploadCount, uploads; } } }
machine ClaimedCheckinService { var claimed: bool; var uploads: int; start state Open { on eSubmitCheckin do (source: machine) { if (!claimed) { claimed = true; uploads = uploads + 1; announce eUploadCount, uploads; } } } }
machine CheckinSubmitter { start state Submit { entry (service: machine) { send service, eSubmitCheckin, this; } } }
spec CheckinUploadsAtMostOnce observes eUploadCount { start state Watch { on eUploadCount do (count: int) { assert count <= 1, "one idempotency key uploaded documents more than once"; } } }
machine TestUnsafeCheckin { start state Init { entry { var service: UnsafeCheckinService; service = new UnsafeCheckinService(); new CheckinSubmitter(service); new CheckinSubmitter(service); } } }
machine TestClaimedCheckin { start state Init { entry { var service: ClaimedCheckinService; service = new ClaimedCheckinService(); new CheckinSubmitter(service); new CheckinSubmitter(service); } } }
module UnsafeCheckinModel = { UnsafeCheckinService }; module ClaimedCheckinModel = { ClaimedCheckinService }; module CheckinSubmitterModel = { CheckinSubmitter };
test tcClaimedCheckin [main=TestClaimedCheckin]: assert CheckinUploadsAtMostOnce in (union ClaimedCheckinModel, CheckinSubmitterModel, { TestClaimedCheckin });
test tcUnsafeCheckin [main=TestUnsafeCheckin]: assert CheckinUploadsAtMostOnce in (union UnsafeCheckinModel, CheckinSubmitterModel, { TestUnsafeCheckin });
