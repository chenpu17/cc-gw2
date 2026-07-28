import { Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Languages, Moon, Sun } from 'lucide-react'
import { navGroups, navigationRoutes } from '@/app/routes'
import { useTheme } from '@/providers/ThemeProvider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘K command palette: mirrors the sidebar nav groups, plus a small set of
 * quick actions (theme toggle, language switch). Selecting a command closes
 * the palette and runs the effect.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { resolved, setMode } = useTheme()

  const groups = useMemo(
    () =>
      navGroups.map((group) => ({
        label: t(group.labelKey),
        items: navigationRoutes
          .filter((route) => group.paths.includes(route.path))
          .map((route) => ({
            path: route.path,
            label: t(route.nav.labelKey),
            description: t(route.nav.descriptionKey),
            Icon: route.nav.icon
          }))
      })),
    [t]
  )

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const toggleTheme = () => setMode(resolved === 'dark' ? 'light' : 'dark')
  const switchLanguage = () => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh'
    void i18n.changeLanguage(next)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('app.commandPalette.title')}>
      <CommandInput placeholder={t('app.commandPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('app.commandPalette.empty')}</CommandEmpty>
        {groups.map((group, index) =>
          group.items.length === 0 ? null : (
            <Fragment key={group.label}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group.label}>
                {group.items.map(({ path, label, description, Icon }) => (
                  <CommandItem
                    key={path}
                    value={`${label} ${path} ${description}`}
                    onSelect={() => run(() => navigate(path))}
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Fragment>
          )
        )}
        <CommandSeparator />
        <CommandGroup heading={t('app.commandPalette.actions')}>
          <CommandItem value={t('app.commandPalette.toggleTheme')} onSelect={() => run(toggleTheme)}>
            {resolved === 'dark' ? (
              <Sun className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Moon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="flex-1">{t('app.commandPalette.toggleTheme')}</span>
          </CommandItem>
          <CommandItem value={t('app.commandPalette.switchLanguage')} onSelect={() => run(switchLanguage)}>
            <Languages className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1">{t('app.commandPalette.switchLanguage')}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
