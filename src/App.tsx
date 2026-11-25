import { ThemeProvider } from './ui/theme';
import { DbProvider } from './ui/DbProvider';
import { Shell } from './ui/Shell';
export default function App() {
  return <ThemeProvider><DbProvider><Shell /></DbProvider></ThemeProvider>;
}
