import { Footer, Header } from './components/ui'
import { How } from './pages/How'
import { Network } from './pages/Network'
import { SitePage } from './pages/Site'
import { useRoute } from './lib/route'

export default function App() {
  const route = useRoute()
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        {route.page === 'network' && <Network />}
        {route.page === 'site' && <SitePage key={route.slug} slug={route.slug} />}
        {route.page === 'how' && <How />}
      </main>
      <Footer />
    </div>
  )
}
