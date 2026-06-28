export type BgMode = 'none' | 'color' | 'image'

export interface BackgroundController {
  getMode(): BgMode
  getColor(): string
  getImage(): HTMLImageElement | null
}

export function initBackground(
  panel: HTMLElement,
  els: {
    btnBgImage: HTMLButtonElement
    bgPopup: HTMLDivElement
    bpNone: HTMLButtonElement
    bpColor: HTMLButtonElement
    bpColorSwatch: HTMLButtonElement
    bpColorInput: HTMLInputElement
    bpImage: HTMLButtonElement
    bgImageInput: HTMLInputElement
  }
): BackgroundController {
  const { btnBgImage, bgPopup, bpNone, bpColor, bpColorSwatch, bpColorInput, bpImage, bgImageInput } = els

  let bgMode: BgMode = 'none'
  let bgColor = '#ffffff'
  let bgImageEl: HTMLImageElement | null = null
  let bgObjectUrl: string | null = null

  function apply() {
    if (bgMode === 'none') {
      panel.style.backgroundImage = ''
      panel.style.backgroundColor = ''
    } else if (bgMode === 'color') {
      panel.style.backgroundImage = ''
      panel.style.backgroundColor = bgColor
    } else if (bgMode === 'image' && bgObjectUrl) {
      panel.style.backgroundImage = `url(${bgObjectUrl})`
      panel.style.backgroundSize = 'cover'
      panel.style.backgroundPosition = 'center'
      panel.style.backgroundColor = ''
    }
    btnBgImage.classList.toggle('active', bgMode !== 'none')
    bpNone.classList.toggle('active', bgMode === 'none')
    bpColor.classList.toggle('active', bgMode === 'color')
    bpImage.classList.toggle('active', bgMode === 'image')
    bpColorSwatch.style.display = bgMode === 'color' ? 'flex' : 'none'
    bpColorSwatch.style.backgroundColor = bgColor
  }

  function closePopup() { bgPopup.classList.remove('open') }

  btnBgImage.addEventListener('click', (e) => { e.stopPropagation(); bgPopup.classList.toggle('open') })
  bgPopup.addEventListener('click', (e) => e.stopPropagation())
  document.addEventListener('click', closePopup)

  bpNone.addEventListener('click', () => { bgMode = 'none'; apply(); closePopup() })

  bpColor.addEventListener('click', () => { bgMode = 'color'; apply(); bpColorInput.click() })
  bpColorSwatch.addEventListener('click', () => bpColorInput.click())
  bpColorInput.addEventListener('input', () => { bgColor = bpColorInput.value; if (bgMode === 'color') apply() })

  bpImage.addEventListener('click', () => bgImageInput.click())
  bgImageInput.addEventListener('change', () => {
    const file = bgImageInput.files?.[0]
    if (!file) return
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl)
    bgObjectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { bgImageEl = img; bgMode = 'image'; apply() }
    img.src = bgObjectUrl
    bgImageInput.value = ''
    closePopup()
  })

  return {
    getMode: () => bgMode,
    getColor: () => bgColor,
    getImage: () => bgImageEl,
  }
}
