// Duplicate channel deliveries for one booking reference must create one booking.
event eCreateBooking: machine; event eBookingCount: int;

machine UnsafeChannelBookings {
  var count: int;
  start state Open { on eCreateBooking do (source: machine) { count = count + 1; announce eBookingCount, count; } }
}

machine UniqueChannelBookings {
  var created: bool;
  var count: int;
  start state Open { on eCreateBooking do (source: machine) { if (!created) { created = true; count = count + 1; announce eBookingCount, count; } } }
}

machine ChannelDelivery { start state Deliver { entry (store: machine) { send store, eCreateBooking, this; } } }
spec ChannelBookingCreatedOnce observes eBookingCount { start state Watch { on eBookingCount do (count: int) { assert count <= 1, "duplicate channel delivery created multiple bookings"; } } }
machine TestUnsafeChannelBooking { start state Init { entry { var store: UnsafeChannelBookings; store = new UnsafeChannelBookings(); new ChannelDelivery(store); new ChannelDelivery(store); } } }
machine TestUniqueChannelBooking { start state Init { entry { var store: UniqueChannelBookings; store = new UniqueChannelBookings(); new ChannelDelivery(store); new ChannelDelivery(store); } } }
module UnsafeChannelBookingsModel = { UnsafeChannelBookings }; module UniqueChannelBookingsModel = { UniqueChannelBookings }; module ChannelDeliveryModel = { ChannelDelivery };
test tcUniqueChannelBooking [main=TestUniqueChannelBooking]: assert ChannelBookingCreatedOnce in (union UniqueChannelBookingsModel, ChannelDeliveryModel, { TestUniqueChannelBooking });
test tcUnsafeChannelBooking [main=TestUnsafeChannelBooking]: assert ChannelBookingCreatedOnce in (union UnsafeChannelBookingsModel, ChannelDeliveryModel, { TestUnsafeChannelBooking });
