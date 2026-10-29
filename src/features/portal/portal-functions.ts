import { createServerFn } from '@tanstack/react-start'
import { portalContext } from '#/server/portal'

// Server functions for the signed-in person in Mina sidor. Everything runs through `runPortal`
// (or `portalContext`), never `runApp`.

export const getPortalContextFn = createServerFn({ method: 'GET' }).handler(() => portalContext())
