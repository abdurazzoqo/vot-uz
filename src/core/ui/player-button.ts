/**
 * Player button injected inside YouTube's player (#movie_player .ytp-right-controls).
 * Constructed using pure DOM / SVG createElementNS APIs to comply with YouTube's Trusted Types policy.
 * Styled matching the Stitch VOT-UZ UI design.
 */

export interface PlayerButtonCallbacks {
  onToggle: (enable: boolean) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class PlayerButton {
  private buttonEl: HTMLButtonElement | null = null;
  private isActive: boolean = false;
  private isPreparing: boolean = false;
  private callbacks: PlayerButtonCallbacks;
  private tooltipText: string = "O'zbekcha ovozli tarjima: Yoqilgan (V)";

  // References to dynamic SVG elements
  private mainPaths: SVGElement[] = [];
  private activeBar: SVGElement | null = null;
  private badgeRect: SVGRectElement | null = null;
  private badgeText: SVGTextElement | null = null;
  private spinnerCircle: SVGCircleElement | null = null;

  constructor(callbacks: PlayerButtonCallbacks) {
    this.callbacks = callbacks;
  }

  public isMounted(): boolean {
    return !!(this.buttonEl && document.contains(this.buttonEl));
  }

  public mount(): boolean {
    if (this.isMounted()) {
      return true;
    }

    const rightControls = document.querySelector('#movie_player .ytp-right-controls');
    if (!rightControls) {
      return false;
    }

    const btn = document.createElement('button');
    btn.className = 'ytp-button vot-uz-player-btn';
    btn.setAttribute('aria-label', this.tooltipText);
    btn.setAttribute('title', this.tooltipText);
    btn.style.position = 'relative';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '48px';
    btn.style.height = '100%';
    btn.style.cursor = 'pointer';
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.outline = 'none';
    btn.style.verticalAlign = 'top';

    // Construct SVG via createElementNS (100% Trusted Types safe, no innerHTML)
    const svg = this.createSvgIcon();
    btn.appendChild(svg);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.isActive = !this.isActive;
      this.updateVisualState();
      this.callbacks.onToggle(this.isActive);
    });

    // Insert before subtitles button or settings button in right controls
    try {
      const target = rightControls.querySelector('.ytp-subtitles-button, .ytp-settings-button');
      if (target && target.parentNode) {
        target.parentNode.insertBefore(btn, target);
      } else {
        rightControls.appendChild(btn);
      }
    } catch {
      try {
        rightControls.appendChild(btn);
      } catch {}
    }

    this.buttonEl = btn;
    this.updateVisualState();
    return true;
  }

  public unmount() {
    if (this.buttonEl && this.buttonEl.parentNode) {
      this.buttonEl.parentNode.removeChild(this.buttonEl);
    }
    this.buttonEl = null;
    this.mainPaths = [];
    this.activeBar = null;
    this.badgeRect = null;
    this.badgeText = null;
    this.spinnerCircle = null;
  }

  public setState(active: boolean, preparing: boolean = false, tooltip?: string) {
    this.isActive = active;
    this.isPreparing = preparing;
    if (tooltip) {
      this.tooltipText = tooltip;
    } else {
      this.tooltipText = `O'zbekcha ovozli tarjima: ${active ? 'Yoqilgan' : 'O\'chirilgan'} (V)`;
    }
    this.updateVisualState();
  }

  private updateVisualState() {
    if (!this.buttonEl) return;

    this.buttonEl.setAttribute('aria-label', this.tooltipText);
    this.buttonEl.setAttribute('title', this.tooltipText);

    const ytBlue = '#3EA6FF';
    const ytWhite = '#ffffff';
    const ytDim = '#717171';

    const iconColor = this.isActive ? ytBlue : ytWhite;

    for (const p of this.mainPaths) {
      p.setAttribute('stroke', iconColor);
    }

    // Active bottom underline indicator (YouTube CC active style)
    if (this.activeBar) {
      this.activeBar.style.display = this.isActive ? 'block' : 'none';
    }

    // UZ badge colors
    if (this.badgeRect && this.badgeText) {
      if (this.isActive) {
        this.badgeRect.setAttribute('fill', ytBlue);
        this.badgeText.setAttribute('fill', '#0F0F0F');
      } else {
        this.badgeRect.setAttribute('fill', '#444444');
        this.badgeText.setAttribute('fill', '#cccccc');
      }
    }

    if (this.spinnerCircle) {
      this.spinnerCircle.style.display = this.isPreparing ? 'block' : 'none';
    }
  }

  private createSvgIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '100%');

    // Style tag for spinner rotation keyframes
    const style = document.createElement('style');
    style.textContent = '@keyframes votSpin { 100% { transform: rotate(360deg); } }';
    svg.appendChild(style);

    // Speech / Voice Head Icon Group
    const micGroup = document.createElementNS(SVG_NS, 'g');
    micGroup.setAttribute('transform', 'translate(6, 4) scale(0.68)');

    // Path 1: Voice capsule (inner mic)
    const capsule = document.createElementNS(SVG_NS, 'path');
    capsule.setAttribute('d', 'M18 6a4 4 0 0 0-4 4v10a4 4 0 0 0 8 0V10a4 4 0 0 0-4-4Z');
    capsule.setAttribute('fill', 'none');
    capsule.setAttribute('stroke', '#ffffff');
    capsule.setAttribute('stroke-width', '2.4');
    capsule.setAttribute('stroke-linecap', 'round');
    capsule.setAttribute('stroke-linejoin', 'round');
    micGroup.appendChild(capsule);

    // Path 2: Voice arc / speech wave
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('d', 'M26 16v4a8 8 0 0 1-16 0v-4');
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', '#ffffff');
    arc.setAttribute('stroke-width', '2.4');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-linejoin', 'round');
    micGroup.appendChild(arc);

    // Line 1: stem
    const line1 = document.createElementNS(SVG_NS, 'line');
    line1.setAttribute('x1', '18'); line1.setAttribute('y1', '28');
    line1.setAttribute('x2', '18'); line1.setAttribute('y2', '32');
    line1.setAttribute('stroke', '#ffffff');
    line1.setAttribute('stroke-width', '2.4');
    line1.setAttribute('stroke-linecap', 'round');
    micGroup.appendChild(line1);

    // Line 2: base
    const line2 = document.createElementNS(SVG_NS, 'line');
    line2.setAttribute('x1', '12'); line2.setAttribute('y1', '32');
    line2.setAttribute('x2', '24'); line2.setAttribute('y2', '32');
    line2.setAttribute('stroke', '#ffffff');
    line2.setAttribute('stroke-width', '2.4');
    line2.setAttribute('stroke-linecap', 'round');
    micGroup.appendChild(line2);

    this.mainPaths = [capsule, arc, line1, line2];
    svg.appendChild(micGroup);

    // UZ Pill Badge at bottom-right
    const badgeGroup = document.createElementNS(SVG_NS, 'g');
    badgeGroup.setAttribute('transform', 'translate(21, 19)');

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '11');
    rect.setAttribute('height', '7');
    rect.setAttribute('rx', '1.5');
    rect.setAttribute('fill', '#3EA6FF');
    badgeGroup.appendChild(rect);
    this.badgeRect = rect;

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', '5.5');
    text.setAttribute('y', '5.5');
    text.setAttribute('font-size', '5');
    text.setAttribute('font-weight', '900');
    text.setAttribute('fill', '#0F0F0F');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'sans-serif');
    text.textContent = 'UZ';
    badgeGroup.appendChild(text);
    this.badgeText = text;

    svg.appendChild(badgeGroup);

    // Active bottom underline indicator (YouTube CC style blue bar)
    const activeBar = document.createElementNS(SVG_NS, 'rect');
    activeBar.setAttribute('x', '8');
    activeBar.setAttribute('y', '32');
    activeBar.setAttribute('width', '20');
    activeBar.setAttribute('height', '2.5');
    activeBar.setAttribute('rx', '1.25');
    activeBar.setAttribute('fill', '#3EA6FF');
    activeBar.style.display = 'block';
    this.activeBar = activeBar;
    svg.appendChild(activeBar);

    // Rotating spinner when preparing
    const spinner = document.createElementNS(SVG_NS, 'circle');
    spinner.setAttribute('cx', '18');
    spinner.setAttribute('cy', '17');
    spinner.setAttribute('r', '13');
    spinner.setAttribute('fill', 'none');
    spinner.setAttribute('stroke', '#3EA6FF');
    spinner.setAttribute('stroke-width', '2');
    spinner.setAttribute('stroke-dasharray', '18 64');
    spinner.setAttribute('stroke-linecap', 'round');
    spinner.style.display = 'none';
    spinner.style.transformOrigin = 'center';
    spinner.style.animation = 'votSpin 0.9s linear infinite';
    this.spinnerCircle = spinner;
    svg.appendChild(spinner);

    return svg;
  }
}
