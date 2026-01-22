interface EnterpriseFeatureProps {
  featureName: string
  description: string
}

export function EnterpriseFeature({ featureName, description }: EnterpriseFeatureProps) {
  return (
    <div className="card max-w-4xl mx-auto">
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
        {/* Lock Icon */}
        <div className="mb-6 p-4 rounded-full bg-app-accent/10 border-2 border-app-accent/30">
          <svg className="w-16 h-16 text-app-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>

        {/* Heading */}
        <div className="mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 mb-3">
            <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Enterprise Feature</span>
          </div>
          <h2 className="text-3xl font-bold mb-2">{featureName}</h2>
          <p className="text-lg text-app-muted max-w-2xl">{description}</p>
        </div>

        {/* Feature List */}
        <div className="mt-8 p-6 bg-app-bg/30 rounded-lg border border-app-border max-w-2xl w-full">
          <h3 className="font-semibold mb-4 text-left">Available in EdisonWatch Enterprise</h3>
          <ul className="text-left space-y-3 text-app-muted">
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-app-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span><strong>Multi-Tenancy</strong>: Manage multiple isolated users and organizations</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-app-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span><strong>SSO Integration</strong>: Enterprise identity provider support</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-app-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span><strong>SIEM Integration</strong>: Enterprise security monitoring</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-app-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span><strong>Client Software</strong>: Auto-enforcement at the client level</span>
            </li>
          </ul>
        </div>

        {/* CTA */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center">
          <a
            href="https://cal.com/eito80/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 font-semibold rounded-lg hover:opacity-90 transition-opacity shadow-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Schedule a Demo
          </a>
          <a
            href="https://edisonwatch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 font-semibold rounded-lg border-2 border-app-accent text-app-accent hover:bg-app-accent/10 transition-colors"
          >
            Learn More
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}
