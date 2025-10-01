import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import HomePage from './page'
import MarkdownPage from './MarkdownPage'

// Dynamic route component that passes the path to MarkdownPage
function DocPage() {
    const params = useParams()
    const path = `/${params['*']}`
    return <MarkdownPage path={path} />
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                {/* Catch-all route for all documentation pages */}
                <Route path="*" element={<DocPage />} />
            </Routes>
        </BrowserRouter>
    )
}

