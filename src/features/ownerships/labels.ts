import type { LeaseStatus } from '#/features/leases/terms'
import { m } from '#/paraglide/messages'

// Client-safe labels for bostadsrätter. Their status uses the lease states: `terminated` means a
// sale is registered and `ended` that it has been transferred.

export const ownershipStatusLabels: Record<LeaseStatus, string> = {
  get upcoming() {
    return m.ownership_status_upcoming()
  },
  get active() {
    return m.ownership_status_active()
  },
  get terminated() {
    return m.ownership_status_terminated()
  },
  get ended() {
    return m.ownership_status_ended()
  },
}
