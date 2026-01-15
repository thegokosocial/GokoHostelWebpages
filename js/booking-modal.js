/**
 * Goko Hostel - Booking Modal
 * Before You Book popup with terms and conditions
 */

(function() {
  'use strict';

  // Booking URL
  const BOOKING_URL = 'https://bookingengine.stayflexi.com/?hotel_id=30819';

  // Inject styles - Uses website fonts: Mohave (headings), Roboto (body)
  const styles = `

    .goko-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(20, 30, 48, 0.7);
      backdrop-filter: blur(4px);
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 10px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .goko-modal-overlay.active {
      display: flex;
      opacity: 1;
    }

    .goko-modal {
      background: linear-gradient(180deg, #FFF9E8 0%, #FFFDF7 100%);
      border-radius: 16px;
      max-width: 480px;
      width: 100%;
      max-height: 95vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.15);
      transform: scale(0.9) translateY(20px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .goko-modal-overlay.active .goko-modal {
      transform: scale(1) translateY(0);
    }

    .goko-modal-header {
      text-align: center;
      padding: 16px 20px 12px;
      border-bottom: 2px dashed #E8D9B8;
    }

    .goko-modal-title {
      font-family: 'Mohave', sans-serif;
      font-size: 1.8rem;
      font-weight: 600;
      color: #2B6B4F;
      margin: 0;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .goko-modal-close {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s ease;
      color: #8B9A8B;
    }

    .goko-modal-close:hover {
      background: rgba(43, 107, 79, 0.1);
      color: #2B6B4F;
    }

    .goko-modal-close svg {
      width: 18px;
      height: 18px;
    }

    .goko-modal-body {
      padding: 14px 20px;
    }

    .goko-note-header {
      font-family: 'Roboto', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      color: #1a3a2a;
      margin: 0 0 10px 0;
    }

    .goko-note-list {
      list-style: none;
      padding: 0;
      margin: 0 0 10px 0;
    }

    .goko-note-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
      font-family: 'Roboto', sans-serif;
      font-size: 0.82rem;
      color: #3a4a4a;
      line-height: 1.4;
    }

    .goko-note-item:last-child {
      margin-bottom: 0;
    }

    .goko-note-icon {
      flex-shrink: 0;
      font-size: 0.95rem;
      margin-top: 0;
    }

    .goko-note-text {
      flex: 1;
    }

    .goko-note-text strong {
      color: #1a3a2a;
      font-weight: 600;
    }

    .goko-note-text a {
      color: #2B6B4F;
      text-decoration: underline;
      font-weight: 500;
    }

    .goko-timing-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 8px 0;
    }

    .goko-timing-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: 'Roboto', sans-serif;
      font-size: 0.82rem;
    }

    .goko-timing-label {
      font-weight: 600;
      color: #E85A4F;
    }

    .goko-timing-value {
      color: #3a4a4a;
    }

    .goko-early-link {
      color: #2B6B4F;
      font-family: 'Roboto', sans-serif;
      font-size: 0.8rem;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: none;
      margin-top: 2px;
    }

    .goko-early-link:hover {
      text-decoration: underline;
    }

    .goko-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, #d4c5a8, transparent);
      margin: 10px 0;
    }

    .goko-warning-box {
      background: #FFF;
      border: 1px solid #E8D9B8;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-family: 'Roboto', sans-serif;
    }

    .goko-warning-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: #1a3a2a;
      margin-bottom: 6px;
    }

    .goko-contact-box {
      background: #F8F4E8;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .goko-contact-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .goko-contact-text {
      font-size: 0.78rem;
      color: #4a5a4a;
      line-height: 1.4;
    }

    .goko-whatsapp-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #25D366;
      font-weight: 600;
      text-decoration: none;
      margin-top: 2px;
    }

    .goko-whatsapp-link:hover {
      text-decoration: underline;
    }

    .goko-modal-footer {
      padding: 0 20px 16px;
    }

    .goko-terms-check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      cursor: pointer;
    }

    .goko-terms-check input {
      display: none;
    }

    .goko-checkbox-custom {
      width: 18px;
      height: 18px;
      border: 2px solid #2B6B4F;
      border-radius: 4px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      background: #fff;
    }

    .goko-terms-check input:checked + .goko-checkbox-custom {
      background: #2B6B4F;
    }

    .goko-checkbox-custom svg {
      width: 12px;
      height: 12px;
      color: #fff;
      opacity: 0;
      transform: scale(0.5);
      transition: all 0.2s ease;
    }

    .goko-terms-check input:checked + .goko-checkbox-custom svg {
      opacity: 1;
      transform: scale(1);
    }

    .goko-terms-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.82rem;
      color: #4a5a4a;
    }

    .goko-terms-link {
      color: #2B6B4F;
      font-weight: 500;
      text-decoration: none;
    }

    .goko-terms-link:hover {
      text-decoration: underline;
    }

    .goko-reserve-btn {
      width: 100%;
      padding: 12px 20px;
      background: linear-gradient(135deg, #EA3639 0%, #D32F2F 100%);
      border: none;
      border-radius: 50px;
      color: #fff;
      font-family: 'Roboto', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(234, 54, 57, 0.25);
      opacity: 0.5;
      pointer-events: none;
    }

    .goko-reserve-btn.enabled {
      opacity: 1;
      pointer-events: auto;
    }

    .goko-reserve-btn.enabled:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(234, 54, 57, 0.35);
      background: linear-gradient(135deg, #F44336 0%, #EA3639 100%);
    }

    .goko-reserve-btn.enabled:active {
      transform: translateY(0);
    }

    /* Redirect Notice */
    .goko-redirect-notice {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 12px;
      padding: 8px 12px;
      background: rgba(234, 54, 57, 0.08);
      border-radius: 8px;
    }

    .goko-redirect-icon {
      font-size: 1.1rem;
    }

    .goko-redirect-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.8rem;
      color: #666;
      text-align: center;
      line-height: 1.4;
    }

    .goko-redirect-text strong {
      color: #EA3639;
      font-weight: 600;
    }

    /* Scrollbar styling */
    .goko-modal::-webkit-scrollbar {
      width: 4px;
    }

    .goko-modal::-webkit-scrollbar-track {
      background: #F8F4E8;
      border-radius: 2px;
    }

    .goko-modal::-webkit-scrollbar-thumb {
      background: #C4B896;
      border-radius: 2px;
    }

    /* Mobile adjustments */
    @media (max-width: 540px) {
      .goko-modal-overlay {
        padding: 8px;
      }

      .goko-modal {
        border-radius: 14px;
      }

      .goko-modal-title {
        font-size: 1.7rem;
      }

      .goko-modal-body {
        padding: 12px 16px;
      }

      .goko-modal-footer {
        padding: 0 16px 14px;
      }

      .goko-note-item {
        font-size: 0.78rem;
      }

      .goko-timing-row {
        flex-direction: row;
        align-items: flex-start;
        gap: 8px;
      }
    }

    /* Early Check-in Popup Styles */
    .goko-early-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(20, 30, 48, 0.7);
      backdrop-filter: blur(4px);
      z-index: 100000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 10px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .goko-early-overlay.active {
      display: flex;
      opacity: 1;
    }

    .goko-early-modal {
      background: #fff;
      border-radius: 16px;
      max-width: 460px;
      width: 100%;
      max-height: 95vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.25);
      transform: scale(0.9) translateY(20px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .goko-early-overlay.active .goko-early-modal {
      transform: scale(1) translateY(0);
    }

    .goko-early-header {
      text-align: center;
      padding: 16px 20px 14px;
      border-bottom: 1px solid #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .goko-early-header-icon {
      color: #E8913A;
      font-size: 1.3rem;
    }

    .goko-early-title {
      font-family: 'Mohave', sans-serif;
      font-size: 1.1rem;
      font-weight: 600;
      color: #E8913A;
      margin: 0;
    }

    .goko-early-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 26px;
      height: 26px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s ease;
      color: #999;
    }

    .goko-early-close:hover {
      background: #f5f5f5;
      color: #333;
    }

    .goko-early-close svg {
      width: 16px;
      height: 16px;
    }

    .goko-early-body {
      padding: 16px 20px;
    }

    .goko-early-info-box {
      background: #FFF9F0;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }

    .goko-early-info-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .goko-early-info-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .goko-early-info-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.85rem;
      color: #333;
      line-height: 1.5;
    }

    .goko-early-amenities {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 0;
      border: 1px solid #f0f0f0;
      border-radius: 10px;
      margin-bottom: 14px;
    }

    .goko-early-amenity {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
      flex: 1;
    }

    .goko-early-amenity-icon {
      font-size: 1.5rem;
      color: #E8913A;
    }

    .goko-early-amenity-icon svg {
      width: 28px;
      height: 28px;
      stroke: #E8913A;
      fill: none;
    }

    .goko-early-amenity-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.72rem;
      color: #555;
      line-height: 1.3;
    }

    .goko-early-checkout-box {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 16px;
    }

    .goko-early-checkout-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
    }

    .goko-early-checkout-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.85rem;
      color: #333;
      line-height: 1.5;
    }

    .goko-early-thanks-btn {
      width: 100%;
      padding: 12px 20px;
      background: #fff;
      border: 2px solid #E8913A;
      border-radius: 50px;
      color: #E8913A;
      font-family: 'Roboto', sans-serif;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .goko-early-thanks-btn:hover {
      background: #FFF9F0;
    }

    @media (max-width: 540px) {
      .goko-early-modal {
        border-radius: 14px;
      }

      .goko-early-title {
        font-size: 1rem;
      }

      .goko-early-body {
        padding: 14px 16px;
      }

      .goko-early-info-text,
      .goko-early-checkout-text {
        font-size: 0.8rem;
      }

      .goko-early-amenity-text {
        font-size: 0.68rem;
      }
    }

    /* Terms & Conditions Popup Styles */
    .goko-terms-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(20, 30, 48, 0.75);
      backdrop-filter: blur(4px);
      z-index: 100001;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 10px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .goko-terms-overlay.active {
      display: flex;
      opacity: 1;
    }

    .goko-terms-modal {
      background: linear-gradient(180deg, #FFF9E8 0%, #FFFDF7 100%);
      border-radius: 16px;
      max-width: 580px;
      width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      position: relative;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.3);
      transform: scale(0.9) translateY(20px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .goko-terms-overlay.active .goko-terms-modal {
      transform: scale(1) translateY(0);
    }

    .goko-terms-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s ease;
      color: #999;
      z-index: 10;
    }

    .goko-terms-close:hover {
      background: rgba(0,0,0,0.05);
      color: #333;
    }

    .goko-terms-close svg {
      width: 18px;
      height: 18px;
    }

    .goko-terms-header {
      text-align: center;
      padding: 12px 20px 12px;
      border-bottom: 1px solid #E8D9B8;
      flex-shrink: 0;
    }

    .goko-terms-logo {
      width: 60px;
      height: 60px;
      margin: 0 auto 10px;
    }

    .goko-terms-logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .goko-terms-main-title {
      font-family: 'Mohave', sans-serif;
      font-size: 1.5rem;
      font-weight: 600;
      color: #2B6B4F;
      margin: 0 0 4px;
    }

    .goko-terms-date {
      font-family: 'Roboto', sans-serif;
      font-size: 0.8rem;
      color: #888;
      margin: 0;
    }

    .goko-terms-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .goko-terms-scroll::-webkit-scrollbar {
      width: 5px;
    }

    .goko-terms-scroll::-webkit-scrollbar-track {
      background: #f5f0e5;
      border-radius: 3px;
    }

    .goko-terms-scroll::-webkit-scrollbar-thumb {
      background: #C4B896;
      border-radius: 3px;
    }

    .goko-terms-intro {
      font-family: 'Roboto', sans-serif;
      font-size: 0.85rem;
      color: #555;
      line-height: 1.6;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px dashed #E8D9B8;
    }

    .goko-terms-section {
      background: #fff;
      border: 1px solid #E8D9B8;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }

    .goko-terms-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    .goko-terms-section-icon {
      font-size: 1.1rem;
      color: #E8913A;
    }

    .goko-terms-section-title {
      font-family: 'Mohave', sans-serif;
      font-size: 1rem;
      font-weight: 600;
      color: #E8913A;
      margin: 0;
    }

    .goko-terms-list {
      list-style: disc;
      padding-left: 20px;
      margin: 0;
    }

    .goko-terms-list li {
      font-family: 'Roboto', sans-serif;
      font-size: 0.82rem;
      color: #444;
      line-height: 1.5;
      margin-bottom: 6px;
    }

    .goko-terms-list li:last-child {
      margin-bottom: 0;
    }

    .goko-terms-important {
      background: #FFF9F0;
      border: 1px solid #E8913A;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 16px;
    }

    .goko-terms-important-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .goko-terms-important-icon {
      font-size: 1rem;
      color: #E8913A;
    }

    .goko-terms-important-title {
      font-family: 'Roboto', sans-serif;
      font-size: 0.9rem;
      font-weight: 600;
      color: #333;
      margin: 0;
    }

    .goko-terms-important-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.82rem;
      color: #555;
      line-height: 1.5;
      margin: 0;
    }

    .goko-terms-footer-info {
      text-align: center;
      padding: 12px 0;
      border-top: 1px dashed #E8D9B8;
    }

    .goko-terms-hostel-name {
      font-family: 'Mohave', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      color: #2B6B4F;
      margin: 0 0 4px;
    }

    .goko-terms-hostel-name span {
      margin-right: 6px;
    }

    .goko-terms-tagline {
      font-family: 'Roboto', sans-serif;
      font-size: 0.75rem;
      color: #888;
      margin: 0;
    }

    .goko-terms-tagline span {
      margin-right: 4px;
    }

    .goko-terms-action {
      padding: 14px 20px;
      background: linear-gradient(180deg, #f5f0e5 0%, #ebe6da 100%);
      border-radius: 0 0 16px 16px;
      flex-shrink: 0;
    }

    .goko-terms-agree-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      cursor: pointer;
    }

    .goko-terms-agree-row input {
      display: none;
    }

    .goko-terms-checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #2B6B4F;
      border-radius: 4px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      background: #fff;
    }

    .goko-terms-agree-row input:checked + .goko-terms-checkbox {
      background: #2B6B4F;
    }

    .goko-terms-checkbox svg {
      width: 12px;
      height: 12px;
      color: #fff;
      opacity: 0;
      transform: scale(0.5);
      transition: all 0.2s ease;
    }

    .goko-terms-agree-row input:checked + .goko-terms-checkbox svg {
      opacity: 1;
      transform: scale(1);
    }

    .goko-terms-agree-text {
      font-family: 'Roboto', sans-serif;
      font-size: 0.85rem;
      color: #444;
    }

    .goko-terms-reserve-btn {
      width: 100%;
      padding: 14px 20px;
      background: linear-gradient(135deg, #EA3639 0%, #D32F2F 100%);
      border: none;
      border-radius: 50px;
      color: #fff;
      font-family: 'Roboto', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(234, 54, 57, 0.25);
      opacity: 0.5;
      pointer-events: none;
    }

    .goko-terms-reserve-btn.enabled {
      opacity: 1;
      pointer-events: auto;
    }

    .goko-terms-reserve-btn.enabled:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(234, 54, 57, 0.35);
      background: linear-gradient(135deg, #F44336 0%, #EA3639 100%);
    }

    @media (max-width: 540px) {
      .goko-terms-modal {
        max-height: 95vh;
        border-radius: 14px;
      }

      .goko-terms-header {
        padding: 16px 16px 12px;
      }

      .goko-terms-logo {
        width: 50px;
        height: 50px;
      }

      .goko-terms-main-title {
        font-size: 1.3rem;
      }

      .goko-terms-scroll {
        padding: 14px 16px;
      }

      .goko-terms-section {
        padding: 12px 14px;
      }

      .goko-terms-list li {
        font-size: 0.78rem;
      }

      .goko-terms-action {
        padding: 12px 16px;
        border-radius: 0 0 14px 14px;
      }
    }
  `;

  // Inject styles into document
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Modal HTML
  const modalHTML = `
    <div class="goko-modal-overlay" id="gokoBookingModal">
      <div class="goko-modal" role="dialog" aria-labelledby="modalTitle" aria-modal="true">
        <button class="goko-modal-close" aria-label="Close modal">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div class="goko-modal-header">
          <h2 class="goko-modal-title" id="modalTitle">Before You Book</h2>
        </div>

        <div class="goko-modal-body">
          <h3 class="goko-note-header">Please Note:</h3>
          
          <ul class="goko-note-list">
            <li class="goko-note-item">
              <span class="goko-note-icon">🎒</span>
              <span class="goko-note-text"><strong>Solo Travelers & Small Groups (Max 4) Only.</strong> We don't accommodate large groups.</span>
            </li>
            <li class="goko-note-item">
              <span class="goko-note-icon">🎂</span>
              <span class="goko-note-text"><strong>Age Limit:</strong> 18 to 35 years only.</span>
            </li>
            <li class="goko-note-item">
              <span class="goko-note-icon">🛏️</span>
              <span class="goko-note-text"><strong>Dorm Allocation:</strong> Subject to availability. We can't guarantee your group stays together.</span>
            </li>
            <li class="goko-note-item">
              <span class="goko-note-icon">🌿</span>
              <span class="goko-note-text"><strong>Non-AC Property:</strong> We don't have air conditioning, but each bed has an individual fan.</span>
            </li>
            <li class="goko-note-item">
              <span class="goko-note-icon">🚶</span>
              <span class="goko-note-text"><strong>Parking & Access:</strong> Hostel is 300m from parking via a scenic trail. Backpacks recommended—no luggage assistance available.</span>
            </li>
            <li class="goko-note-item">
              <span class="goko-note-icon">🚫</span>
              <span class="goko-note-text"><strong>Strictly No:</strong> Hard liquor, drugs, outside food & drinks.</span>
            </li>
          </ul>

          <div class="goko-timing-row">
            <div class="goko-timing-item">
              <span class="goko-note-icon">🚪</span>
              <span class="goko-timing-label">Check-in:</span>
              <span class="goko-timing-value">12:00 Noon</span>
            </div>
            <div class="goko-timing-item">
              <span class="goko-note-icon">🎒</span>
              <span class="goko-timing-label">Check-out:</span>
              <span class="goko-timing-value">10:00 AM</span>
            </div>
          </div>

          <a href="#" class="goko-early-link" id="gokoEarlyCheckinLink">
            📍 Coming in before check-in time?
          </a>

          <div class="goko-divider"></div>

          <div class="goko-warning-box">
            <p class="goko-warning-title">Goko Management reserves the right to cancel any booking if terms and conditions are not met.</p>
            <div class="goko-contact-box">
              <span class="goko-contact-icon">📬</span>
              <div>
                <span class="goko-contact-text">If you don't meet any of these criteria but still wish to stay with us, please reach out on</span><br>
                <a href="https://wa.me/919113365888" target="_blank" class="goko-whatsapp-link">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="goko-modal-footer">
          <label class="goko-terms-check">
            <input type="checkbox" id="gokoTermsCheckbox">
            <span class="goko-checkbox-custom">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span class="goko-terms-text">I agree to the <a href="#" class="goko-terms-link" id="gokoTermsLink">terms and conditions</a></span>
          </label>

          <button class="goko-reserve-btn" id="gokoReserveBtn">Reserve My Spot</button>
          
          <div class="goko-redirect-notice">
            <span class="goko-redirect-icon">📢</span>
            <span class="goko-redirect-text">You will be redirected to our trusted partner<br><strong>StayFlexi</strong></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Early Check-in Popup -->
    <div class="goko-early-overlay" id="gokoEarlyModal">
      <div class="goko-early-modal" role="dialog" aria-labelledby="earlyTitle" aria-modal="true">
        <button class="goko-early-close" aria-label="Close" id="gokoEarlyClose">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div class="goko-early-header">
          <span class="goko-early-header-icon">⏰</span>
          <h3 class="goko-early-title" id="earlyTitle">Coming in before check-in time?</h3>
        </div>

        <div class="goko-early-body">
          <div class="goko-early-info-box">
            <div class="goko-early-info-row">
              <span class="goko-early-info-icon">🛏️</span>
              <p class="goko-early-info-text">
                We don't have early check-in. But you could come early and use the common washroom and chill in the common area — we have beds, hammocks, and bean bags to relax. If the beds are available, then definitely we will try to accommodate early ✔️
              </p>
            </div>
          </div>

          <div class="goko-early-amenities">
            <div class="goko-early-amenity">
              <div class="goko-early-amenity-icon">
                <svg viewBox="0 0 24 24" stroke-width="1.5">
                  <path d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 18v2M21 18v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3"/>
                </svg>
              </div>
              <span class="goko-early-amenity-text">Use Beds, Hammocks and Beanbags</span>
            </div>
            <div class="goko-early-amenity">
              <div class="goko-early-amenity-icon">
                <svg viewBox="0 0 24 24" stroke-width="1.5">
                  <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                  <path d="M11 7h2v5h-2zM11 14h2v2h-2z"/>
                </svg>
              </div>
              <span class="goko-early-amenity-text">Enjoy Yummy food at the Café</span>
            </div>
            <div class="goko-early-amenity">
              <div class="goko-early-amenity-icon">
                <svg viewBox="0 0 24 24" stroke-width="1.5">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
                </svg>
              </div>
              <span class="goko-early-amenity-text">Relax</span>
            </div>
          </div>

          <div class="goko-early-checkout-box">
            <span class="goko-early-checkout-icon">🎒</span>
            <p class="goko-early-checkout-text">
              The same applies to checkout as well. You can keep your luggage 🎒 near the reception at the time of checkout and chill in the common area till you leave.
            </p>
          </div>

          <button class="goko-early-thanks-btn" id="gokoEarlyThanksBtn">Thanks for the cooperation 🙏</button>
        </div>
      </div>
    </div>

    <!-- Terms & Conditions Popup -->
    <div class="goko-terms-overlay" id="gokoTermsModal">
      <div class="goko-terms-modal" role="dialog" aria-labelledby="termsTitle" aria-modal="true">
        <button class="goko-terms-close" aria-label="Close" id="gokoTermsClose">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div class="goko-terms-header">
          <h2 class="goko-terms-main-title" id="termsTitle">Terms & Conditions</h2>
          <p class="goko-terms-date">Last Updated: January 2025</p>
        </div>

        <div class="goko-terms-scroll">
          <p class="goko-terms-intro">
            Welcome to Goko Hostel. We kindly ask you to review these Terms & Conditions prior to making a reservation or checking in. By booking with us or staying at our property, you confirm your acceptance of these terms.
          </p>

          <div class="goko-terms-section">
            <div class="goko-terms-section-header">
              <span class="goko-terms-section-icon">📋</span>
              <h3 class="goko-terms-section-title">Who Can Stay</h3>
            </div>
            <ul class="goko-terms-list">
              <li>Our hostel welcomes solo adventurers and small groups of up to 4 people.</li>
              <li>We're unable to host large groups or party gatherings.</li>
              <li>Guests must be between 18 and 35 years of age.</li>
              <li>Unfortunately, we cannot accommodate children at the property.</li>
              <li>Bookings of multiple beds may be subject to additional policies and charges.</li>
              <li>No parties, celebrations, or loud events are permitted on premises.</li>
            </ul>
          </div>

          <div class="goko-terms-section">
            <div class="goko-terms-section-header">
              <span class="goko-terms-section-icon">🤝</span>
              <h3 class="goko-terms-section-title">Guest Behavior & Expectations</h3>
            </div>
            <ul class="goko-terms-list">
              <li>Please be considerate of fellow travelers and our team members.</li>
              <li>Smoking, drinking alcohol in dorms, recreational drugs, and disruptive conduct are not tolerated.</li>
              <li>Any damage to hostel or café property will be the guest's financial responsibility.</li>
              <li>We cannot be held accountable for lost, stolen, or damaged personal items.</li>
              <li>We reserve the right to end a guest's stay immediately (without refund) for rule violations or inappropriate behavior.</li>
            </ul>
          </div>

          <div class="goko-terms-section">
            <div class="goko-terms-section-header">
              <span class="goko-terms-section-icon">💳</span>
              <h3 class="goko-terms-section-title">Reservations & Payments</h3>
            </div>
            <ul class="goko-terms-list">
              <li>All reservations depend on bed availability and are subject to confirmation.</li>
              <li>We may decline any booking at our discretion without explanation.</li>
              <li>We accept UPI transfers and cash only — no card payments available.</li>
              <li>Room rates may fluctuate and are subject to change at any time.</li>
              <li>Government-issued photo ID is mandatory for all guests upon arrival.</li>
              <li>Arrival time: 12:00 PM onwards. Departure time: by 10:00 AM.</li>
            </ul>
          </div>

          <div class="goko-terms-section">
            <div class="goko-terms-section-header">
              <span class="goko-terms-section-icon">⚠️</span>
              <h3 class="goko-terms-section-title">Safety & Responsibility</h3>
            </div>
            <ul class="goko-terms-list">
              <li>Ocean swimming is strictly forbidden due to dangerous currents in the area.</li>
              <li>While we prioritize guest safety, we cannot be liable for any accidents, injuries, or mishaps that occur during your stay.</li>
              <li>By choosing to stay with us, you acknowledge and accept all associated risks.</li>
              <li>This agreement releases Goko Hostel and its staff from any claims related to your visit.</li>
            </ul>
          </div>

          <div class="goko-terms-important">
            <div class="goko-terms-important-header">
              <span class="goko-terms-important-icon">⚡</span>
              <h4 class="goko-terms-important-title">Please Note:</h4>
            </div>
            <p class="goko-terms-important-text">
              These Terms & Conditions work alongside our Privacy Policy and House Rules. By reserving a bed or staying at Goko Hostel, you confirm that you've read, understood, and agree to everything outlined in these documents.
            </p>
          </div>

          <div class="goko-terms-footer-info">
            <p class="goko-terms-hostel-name"><span>🚀</span>Goko Hostel - Gokarna</p>
            <p class="goko-terms-tagline"><span>📍</span>Community Living | Local Experiences | Traveler's Paradise</p>
          </div>
        </div>

        <div class="goko-terms-action">
          <label class="goko-terms-agree-row">
            <input type="checkbox" id="gokoTermsAgreeCheckbox">
            <span class="goko-terms-checkbox">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span class="goko-terms-agree-text">I have read and accept these terms</span>
          </label>
          <button class="goko-terms-reserve-btn" id="gokoTermsReserveBtn">Agree & Reserve My Spot</button>
          
          <div class="goko-redirect-notice">
            <span class="goko-redirect-icon">📢</span>
            <span class="goko-redirect-text">You will be redirected to our trusted partner<br><strong>StayFlexi</strong></span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wait for DOM to be ready
  function init() {
    // Inject modal into body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Get elements
    const modal = document.getElementById('gokoBookingModal');
    const closeBtn = modal.querySelector('.goko-modal-close');
    const checkbox = document.getElementById('gokoTermsCheckbox');
    const reserveBtn = document.getElementById('gokoReserveBtn');
    const modalContent = modal.querySelector('.goko-modal');

    // Find all book now buttons
    const bookNowButtons = document.querySelectorAll(
      'a.button[href*="google.com/maps"], ' +
      'a.w-button[href*="google.com/maps"], ' +
      'a[class*="book-now"], ' +
      '.book-now-blink, ' +
      'a:is([href*="booking"], [href*="book"]):not([href*="facebook"]):not([href*="twitter"])'
    );

    // Also match buttons with BOOK NOW text
    document.querySelectorAll('a.button, a.w-button').forEach(btn => {
      if (btn.textContent.trim().toUpperCase().includes('BOOK NOW') || 
          btn.textContent.trim().toUpperCase().includes('BOOK A BED')) {
        btn.addEventListener('click', openModal);
      }
    });

    // Add click handlers to book now buttons
    bookNowButtons.forEach(btn => {
      btn.addEventListener('click', openModal);
    });

    // Open modal function
    function openModal(e) {
      e.preventDefault();
      e.stopPropagation();
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Focus the modal for accessibility
      setTimeout(() => {
        closeBtn.focus();
      }, 100);
    }

    // Close modal function
    function closeModal() {
      modal.classList.remove('active');
      document.body.style.overflow = '';
      checkbox.checked = false;
      reserveBtn.classList.remove('enabled');
    }

    // Close button click
    closeBtn.addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Checkbox toggle
    checkbox.addEventListener('change', function() {
      if (this.checked) {
        reserveBtn.classList.add('enabled');
      } else {
        reserveBtn.classList.remove('enabled');
      }
    });

    // Reserve button click
    reserveBtn.addEventListener('click', function() {
      if (checkbox.checked) {
        window.open(BOOKING_URL, '_blank');
        closeModal();
      }
    });

    // Prevent modal content clicks from closing modal
    modalContent.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Early Check-in Popup functionality
    const earlyModal = document.getElementById('gokoEarlyModal');
    const earlyLink = document.getElementById('gokoEarlyCheckinLink');
    const earlyCloseBtn = document.getElementById('gokoEarlyClose');
    const earlyThanksBtn = document.getElementById('gokoEarlyThanksBtn');
    const earlyModalContent = earlyModal.querySelector('.goko-early-modal');

    // Open early check-in popup
    earlyLink.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      modal.classList.remove('active');
      earlyModal.classList.add('active');
    });

    // Close early popup and go back to main popup
    function closeEarlyAndGoBack() {
      earlyModal.classList.remove('active');
      modal.classList.add('active');
    }

    // Thanks button - go back to main popup
    earlyThanksBtn.addEventListener('click', closeEarlyAndGoBack);

    // Close button on early popup - go back to main popup
    earlyCloseBtn.addEventListener('click', closeEarlyAndGoBack);

    // Click outside early popup to go back
    earlyModal.addEventListener('click', function(e) {
      if (e.target === earlyModal) {
        closeEarlyAndGoBack();
      }
    });

    // Prevent early modal content clicks from closing
    earlyModalContent.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Terms & Conditions Popup functionality
    const termsModal = document.getElementById('gokoTermsModal');
    const termsLink = document.getElementById('gokoTermsLink');
    const termsCloseBtn = document.getElementById('gokoTermsClose');
    const termsAgreeCheckbox = document.getElementById('gokoTermsAgreeCheckbox');
    const termsReserveBtn = document.getElementById('gokoTermsReserveBtn');
    const termsModalContent = termsModal.querySelector('.goko-terms-modal');

    // Open terms popup
    termsLink.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      modal.classList.remove('active');
      termsModal.classList.add('active');
    });

    // Close terms popup and go back to main popup
    function closeTermsAndGoBack() {
      termsModal.classList.remove('active');
      termsAgreeCheckbox.checked = false;
      termsReserveBtn.classList.remove('enabled');
      modal.classList.add('active');
    }

    // Close button on terms popup - go back to main popup
    termsCloseBtn.addEventListener('click', closeTermsAndGoBack);

    // Click outside terms popup to go back
    termsModal.addEventListener('click', function(e) {
      if (e.target === termsModal) {
        closeTermsAndGoBack();
      }
    });

    // Prevent terms modal content clicks from closing
    termsModalContent.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Terms checkbox toggle
    termsAgreeCheckbox.addEventListener('change', function() {
      if (this.checked) {
        termsReserveBtn.classList.add('enabled');
      } else {
        termsReserveBtn.classList.remove('enabled');
      }
    });

    // Terms reserve button - also check the main modal checkbox and proceed
    termsReserveBtn.addEventListener('click', function() {
      if (termsAgreeCheckbox.checked) {
        // Check the main modal checkbox too
        checkbox.checked = true;
        reserveBtn.classList.add('enabled');
        // Open booking URL
        window.open(BOOKING_URL, '_blank');
        // Close everything
        termsModal.classList.remove('active');
        termsAgreeCheckbox.checked = false;
        termsReserveBtn.classList.remove('enabled');
        closeModal();
      }
    });

    // Escape key handler for all modals
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (termsModal.classList.contains('active')) {
          closeTermsAndGoBack();
        } else if (earlyModal.classList.contains('active')) {
          closeEarlyAndGoBack();
        } else if (modal.classList.contains('active')) {
          closeModal();
        }
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
