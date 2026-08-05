import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface SoundSettings {
  bgMusicEnabled: boolean
  ballSoundEnabled: boolean
  setBgMusic: (v: boolean) => void
  setBallSound: (v: boolean) => void
}

const SoundContext = createContext<SoundSettings>({
  bgMusicEnabled: true,
  ballSoundEnabled: true,
  setBgMusic: () => {},
  setBallSound: () => {},
})

export function SoundProvider({ children }: { children: ReactNode }) {
  const [bgMusicEnabled, setBgMusicRaw] = useState<boolean>(() => {
    try { return localStorage.getItem('sound_bgMusic') !== 'false' } catch { return true }
  })
  const [ballSoundEnabled, setBallSoundRaw] = useState<boolean>(() => {
    try { return localStorage.getItem('sound_ballSound') !== 'false' } catch { return true }
  })

  const setBgMusic = (v: boolean) => {
    try { localStorage.setItem('sound_bgMusic', String(v)) } catch {}
    setBgMusicRaw(v)
  }

  const setBallSound = (v: boolean) => {
    try { localStorage.setItem('sound_ballSound', String(v)) } catch {}
    setBallSoundRaw(v)
  }

  return (
    <SoundContext.Provider value={{ bgMusicEnabled, ballSoundEnabled, setBgMusic, setBallSound }}>
      {children}
    </SoundContext.Provider>
  )
}

export function useSoundSettings() {
  return useContext(SoundContext)
}
