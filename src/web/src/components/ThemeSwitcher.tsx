import { AppWindow, BookOpen, Droplets, Flower2, Minus, Monitor, Moon, Sparkles, Square, Sun, Waves, Zap, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SKINS, useTheme, type Skin } from '@/providers/ThemeProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * Record (not an array) so a newly added `Skin` fails to compile until it gets
 * an icon, and the menu order always follows the canonical `SKINS` list used
 * by the ⌘K family cycle.
 */
const SKIN_ICONS: Record<Skin, LucideIcon> = {
  minimal: Minus,
  classic: AppWindow,
  paper: BookOpen,
  glass: Droplets,
  modernist: Square,
  neon: Zap,
  aurora: Sparkles,
  sakura: Flower2,
  ocean: Waves
}

const modes: Array<{ mode: 'light' | 'dark' | 'system'; labelKey: string; icon: typeof Sun }> = [
  { mode: 'light', labelKey: 'common.theme.light', icon: Sun },
  { mode: 'dark', labelKey: 'common.theme.dark', icon: Moon },
  { mode: 'system', labelKey: 'common.theme.system', icon: Monitor }
]

export function ThemeSwitcher() {
  const { mode, setMode, resolved, skin, setSkin } = useTheme()
  const { t } = useTranslation()

  const currentMode = modes.find(m => m.mode === mode)
  const Icon = currentMode?.icon || (resolved === 'dark' ? Moon : Sun)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('common.theme.label')}
          data-testid="theme-switcher-trigger"
        >
          <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t(currentMode?.labelKey ?? 'common.theme.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('common.theme.skinGroupLabel')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skin} onValueChange={(value) => setSkin(value as Skin)}>
          {SKINS.map((skinId) => {
            const ItemIcon = SKIN_ICONS[skinId]
            return (
              <DropdownMenuRadioItem key={skinId} value={skinId}>
                <ItemIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                {t(`common.theme.families.${skinId}`)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('common.theme.modeGroupLabel')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as 'light' | 'dark' | 'system')}
        >
          {modes.map((item) => {
            const ItemIcon = item.icon
            return (
              <DropdownMenuRadioItem key={item.mode} value={item.mode}>
                <ItemIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                {t(item.labelKey)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
