import { useQuery } from '#/lib/typed-query'
import { createFileRoute } from '@tanstack/react-router'
import { HealthDocument } from '#/graphql/generated/graphql'

export const Route = createFileRoute('/health')({
  component: HealthPage,
})

function HealthPage() {
  const { loading, error, data } = useQuery(HealthDocument)

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Health Check</h1>

      {loading && <div className="text-muted">Loading...</div>}

      {error && <div className="text-red-500">Error: {error.message}</div>}

      {data && (
        <div className="rounded-lg border p-6">
          <div className="text-sm text-muted">GraphQL Response</div>
          <div className="mt-2 text-3xl font-mono">{data.health}</div>
          <div className="mt-1 text-xs text-muted">from https://sa-api.localhost/api/graphql</div>
        </div>
      )}
    </div>
  )
}
