import { ThemeProvider } from './ui/theme';
import { DbProvider } from './ui/DbProvider';
import { Shell } from './ui/Shell';
import { LockGate } from './ui/Lock';
export default function App() {
  return <ThemeProvider><DbProvider><LockGate><Shell /></LockGate></DbProvider></ThemeProvider>;
}
