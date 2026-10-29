import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/company-details')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_app/company-details"!</div>
}
