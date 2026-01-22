interface Feature {
  name: string
  openEdison: boolean
  edisonWatch: boolean
}

const features: Feature[] = [
  { name: 'Single User', openEdison: true, edisonWatch: true },
  { name: 'MCP Security Controls', openEdison: true, edisonWatch: true },
  { name: 'Lethal Trifecta Detection', openEdison: true, edisonWatch: true },
  { name: 'Tool/Resource Permissions', openEdison: true, edisonWatch: true },
  { name: 'Multi-Tenancy', openEdison: false, edisonWatch: true },
  { name: 'SIEM Integration', openEdison: false, edisonWatch: true },
  { name: 'SSO (Single Sign-On)', openEdison: false, edisonWatch: true },
  { name: 'Client Software for Auto-Enforcement', openEdison: false, edisonWatch: true },
]

function CheckIcon() {
  return <span className="text-green-400 text-xl">✅</span>
}

function CrossIcon() {
  return <span className="text-rose-400 text-xl">❌</span>
}

export function ComparisonTable() {
  return (
    <div className="card max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-2">OpenEdison vs EdisonWatch</h2>
        <p className="text-app-muted">
          EdisonWatch adds Multi-Tenancy, SIEM, SSO, and Auto-Enforcement
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-app-border py-3 px-4 text-left font-semibold">Feature</th>
              <th className="border-b border-app-border py-3 px-4 text-center font-semibold">
                OpenEdison<br />
                <span className="text-sm font-normal text-app-muted">(Open Source)</span>
              </th>
              <th className="border-b border-app-border py-3 px-4 text-center font-semibold">
                EdisonWatch<br />
                <span className="text-sm font-normal text-app-muted">(Commercial)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {features.map((feature, index) => (
              <tr key={index} className={index % 2 === 0 ? 'bg-app-bg/30' : ''}>
                <td className="border-b border-app-border py-3 px-4">{feature.name}</td>
                <td className="border-b border-app-border py-3 px-4 text-center">
                  {feature.openEdison ? <CheckIcon /> : <CrossIcon />}
                </td>
                <td className="border-b border-app-border py-3 px-4 text-center">
                  {feature.edisonWatch ? <CheckIcon /> : <CrossIcon />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 p-4 bg-app-bg/30 rounded border border-app-border">
        <h3 className="font-semibold mb-2 text-amber-400">Enterprise Features Exclusive to EdisonWatch</h3>
        <ul className="list-disc list-inside text-app-muted space-y-1">
          <li><strong>Multi-Tenancy</strong>: Support for multiple isolated users and organizations</li>
          <li><strong>SIEM Integration</strong>: Enterprise security information and event management</li>
          <li><strong>SSO (Single Sign-On)</strong>: Integration with enterprise identity providers</li>
          <li><strong>Client Software for Auto-Enforcement</strong>: Automated policy enforcement at the client level</li>
        </ul>
      </div>

      <div className="mt-6 p-6 bg-gradient-to-r from-app-accent/10 to-app-accent/5 rounded-lg border-2 border-app-accent/30">
        <div className="text-center space-y-4">
          <h3 className="text-xl font-semibold text-app-accent">Interested in EdisonWatch Enterprise?</h3>
          <p className="text-app-muted max-w-2xl mx-auto">
            Schedule a personalized demo to see how EdisonWatch can secure your organization's AI agents with enterprise-grade features.
          </p>
          <a
            href="https://cal.com/eito80/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-6 py-3 font-semibold rounded-lg hover:opacity-90 transition-opacity shadow-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
          >
            Book a Demo Call
          </a>
        </div>
      </div>

      <div className="mt-4 text-center text-sm text-app-muted">
        <p>
          For more information about EdisonWatch commercial licensing, please visit{' '}
          <a
            href="https://edisonwatch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-app-accent hover:underline"
          >
            edisonwatch.com
          </a>
        </p>
      </div>
    </div>
  )
}
