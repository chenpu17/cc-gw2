import { AppWindow, BookOpen, Droplets, Flower2, Minus, Monitor, Moon, Sparkles, Square, Sun, Waves, Zap } from 'lucide-react'
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

const skins: Array<{ skin: Skin; icon: typeof Sun }> = [
  { skin: 'minimal', icon: Minus },
  { skin: 'classic', icon: AppWindow },
  { skin: 'paper', icon: BookOpen },
  { skin: 'glass', icon: Droplets },
  { skin: 'modernist', icon: Square },
  { skin: 'neon', icon: Zap },
  { skin: 'aurora', icon: Sparkles },
  { skin: 'sakura', icon: Flower2 },
  { skin: 'ocean', icon: Waves }
]

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
          {skins.map((item) => {
            const ItemIcon = item.icon
            return (
              <DropdownMenuRadioItem key={item.skin} value={item.skin}>
                <ItemIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                {t(`common.theme.families.${item.skin}`)}
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
