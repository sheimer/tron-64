export class WelcomeView {
  constructor({ onEnterLobby }) {
    this.onEnterLobby = onEnterLobby

    this.layout = document.getElementById('layout')
    this.container = document.getElementById('welcome')
    this.btnHeaderEnterLobby = document.getElementById('btn-header-enter-lobby')
    this.btnInfo = document.getElementById('btn-info')

    this.modalLegal = document.getElementById('modal-legal')
    this.modalPrivacy = document.getElementById('modal-privacy')
    this.btnOpenLegal = document.getElementById('btn-open-legal')
    this.btnOpenPrivacy = document.getElementById('btn-open-privacy')
    this.btnCloseLegal = document.getElementById('btn-close-legal')
    this.btnClosePrivacy = document.getElementById('btn-close-privacy')

    this.initEvents()
    this.hydrateMailLinks()
  }

  hydrateMailLinks() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return
    document.querySelectorAll('.mail-link').forEach((el) => {
      const user = el.getAttribute ? el.getAttribute('data-user') : el.dataset?.user
      const domain = el.getAttribute ? el.getAttribute('data-domain') : el.dataset?.domain
      if (user && domain) {
        const email = `${user}@${domain}`
        const a = document.createElement('a')
        a.href = `mailto:${email}`
        a.textContent = email
        a.className = 'link-external'
        if (el.replaceWith) {
          el.replaceWith(a)
        } else if (el.parentNode) {
          el.parentNode.replaceChild(a, el)
        }
      }
    })
  }

  initEvents() {
    if (this.btnHeaderEnterLobby) {
      this.btnHeaderEnterLobby.addEventListener('click', () => {
        if (this.onEnterLobby) this.onEnterLobby()
      })
    }

    if (this.btnOpenLegal) {
      this.btnOpenLegal.addEventListener('click', (e) => {
        e.preventDefault()
        this.openModal(this.modalLegal)
      })
    }

    if (this.btnOpenPrivacy) {
      this.btnOpenPrivacy.addEventListener('click', (e) => {
        e.preventDefault()
        this.openModal(this.modalPrivacy)
      })
    }

    if (this.btnCloseLegal) {
      this.btnCloseLegal.addEventListener('click', () => this.closeModals())
    }

    if (this.btnClosePrivacy) {
      this.btnClosePrivacy.addEventListener('click', () => this.closeModals())
    }

    // Close on backdrop click
    ;[this.modalLegal, this.modalPrivacy].forEach((modal) => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (
            e.target === modal ||
            e.target.classList.contains('modal-backdrop')
          ) {
            this.closeModals()
          }
        })
      }
    })

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModals()
      }
    })
  }

  openModal(modal) {
    this.closeModals()
    if (modal) modal.style.display = 'flex'
  }

  closeModals() {
    if (this.modalLegal) this.modalLegal.style.display = 'none'
    if (this.modalPrivacy) this.modalPrivacy.style.display = 'none'
  }

  show() {
    if (this.layout) this.layout.classList.add('screen-welcome')
    if (this.container) this.container.style.display = ''
    if (this.btnHeaderEnterLobby) this.btnHeaderEnterLobby.style.display = ''
    if (this.btnInfo) this.btnInfo.style.display = 'none'
  }

  hide() {
    if (this.layout) this.layout.classList.remove('screen-welcome')
    if (this.container) this.container.style.display = 'none'
    if (this.btnHeaderEnterLobby) this.btnHeaderEnterLobby.style.display = 'none'
    if (this.btnInfo) this.btnInfo.style.display = ''
    this.closeModals()
  }
}
