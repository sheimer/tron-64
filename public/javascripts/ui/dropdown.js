const openedContent = new Set()

export const initDropdowns = () => {
  document.querySelectorAll('.dropdown').forEach((dropdown) => {
    dropdown.onclick = (evt) => {
      const content = dropdown.querySelector('.dropdown-content')
      if (!content) {
        return
      }

      if (content.contains(evt.target)) {
        return
      }

      const isClosed = content.style.display !== 'flex'
      content.style.display = isClosed ? 'flex' : 'none'
      if (isClosed) {
        openedContent.add(dropdown)
      } else {
        openedContent.delete(dropdown)
      }
    }
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDropdowns, false)
  } else {
    initDropdowns()
  }

  document.onclick = (evt) => {
    const removeItems = []
    openedContent.forEach((dropdown) => {
      if (!dropdown.contains(evt.target)) {
        const content = dropdown.querySelector('.dropdown-content')
        if (content) {
          content.style.display = 'none'
        }
        removeItems.push(dropdown)
      }
    })
    removeItems.forEach((dropdown) => {
      openedContent.delete(dropdown)
    })
  }
}
