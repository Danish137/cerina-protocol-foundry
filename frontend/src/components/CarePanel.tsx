import { useState } from 'react'
import { HeartHandshake, Phone, Globe, ExternalLink, ShieldAlert, ArrowRight } from 'lucide-react'
import { CareResources } from '../types'

interface CarePanelProps {
  resources?: CareResources
  onClinicianContinue: () => void
  onStartNew: () => void
}

const DEFAULT_RESOURCES: CareResources = {
  region: {
    country: 'United States',
    name: '988 Suicide & Crisis Lifeline',
    phone: '988',
    text: '988',
    website: 'https://988lifeline.org',
    hours: '24/7, Free & Confidential'
  },
  fallback: {
    name: 'Find A Helpline (Global)',
    website: 'https://findahelpline.com',
    description: 'Free, confidential crisis support services in over 130 countries.'
  },
  all_regions: {
    US: {
      country: 'United States',
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      text: '988',
      website: 'https://988lifeline.org',
      hours: '24/7, Free & Confidential'
    },
    IN: {
      country: 'India',
      name: 'Tele-MANAS (National Tele Mental Health Programme)',
      phone: '14416',
      alt_phone: '1800-891-4416',
      website: 'https://telemanas.mohfw.gov.in',
      hours: '24/7, Free, Multilingual'
    },
    GB: {
      country: 'United Kingdom',
      name: 'Samaritans',
      phone: '116 123',
      website: 'https://www.samaritans.org',
      hours: '24/7, Free & Confidential'
    },
    IE: {
      country: 'Ireland',
      name: 'Samaritans Ireland',
      phone: '116 123',
      website: 'https://www.samaritans.org/ireland/samaritans-ireland/',
      hours: '24/7, Free & Confidential'
    }
  }
}

export default function CarePanel({
  resources = DEFAULT_RESOURCES,
  onClinicianContinue,
  onStartNew
}: CarePanelProps) {
  const [selectedRegionKey, setSelectedRegionKey] = useState<string>('US')
  const currentRegion =
    (resources.all_regions && resources.all_regions[selectedRegionKey]) || resources.region

  return (
    <div className="max-w-2xl mx-auto my-8 p-8 rounded-2xl bg-[#FFFDF9] border border-[#E8DFC8] shadow-md space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-[#E8DFC8]">
        <div className="p-2.5 rounded-xl bg-[#F5EDE0] text-[#8C4A26]">
          <HeartHandshake className="w-6 h-6" />
        </div>
        <div>
          <h2 className="font-serif text-xl font-medium text-[#2C211A]">Support Resources & Crisis Help</h2>
          <p className="text-xs text-[#7A6A5E]">
            We detected themes related to severe distress or self-harm. Confidential care is always available.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Region selector if multiple regions available */}
        {resources.all_regions && Object.keys(resources.all_regions).length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#7A6A5E] font-medium">Select Region:</span>
            <div className="inline-flex rounded-lg border border-[#E8DFC8] p-0.5 bg-[#FAF8F5]">
              {Object.entries(resources.all_regions).map(([code, reg]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setSelectedRegionKey(code)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                    selectedRegionKey === code
                      ? 'bg-white shadow-xs text-[#8C4A26] font-semibold'
                      : 'text-[#7A6A5E] hover:text-[#2C211A]'
                  }`}
                >
                  {reg.country}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Primary regional hotline card */}
        <div className="p-5 rounded-xl bg-white border border-[#E8DFC8] space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-[#8C4A26]">
                {currentRegion.country} Hotline
              </span>
              <h3 className="font-serif text-lg font-medium text-[#2C211A]">{currentRegion.name}</h3>
              <p className="text-xs text-[#7A6A5E]">{currentRegion.hours}</p>
            </div>
            <a
              href={`tel:${currentRegion.phone}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C4A26] text-white text-sm font-semibold hover:bg-[#733B1E] transition-colors shadow-xs"
            >
              <Phone className="w-4 h-4" />
              <span>Call {currentRegion.phone}</span>
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[#F5EDE0] text-xs text-[#7A6A5E]">
            {currentRegion.text && (
              <span>
                <strong>Text:</strong> {currentRegion.text}
              </span>
            )}
            {currentRegion.alt_phone && (
              <span>
                <strong>Toll-free:</strong> {currentRegion.alt_phone}
              </span>
            )}
            <a
              href={currentRegion.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#8C4A26] hover:underline ml-auto"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Official Website</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Fallback global helpline */}
        {resources.fallback && (
          <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E8DFC8] flex items-center justify-between text-xs">
            <div>
              <p className="font-semibold text-[#2C211A]">{resources.fallback.name}</p>
              <p className="text-[#7A6A5E]">{resources.fallback.description}</p>
            </div>
            <a
              href={resources.fallback.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#8C4A26] font-semibold hover:underline shrink-0"
            >
              <span>Browse Worldwide</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <p className="text-[11px] text-[#7A6A5E] text-center italic">
          Resources as of October 2026, re-check periodically.
        </p>
      </div>

      {/* Action buttons */}
      <div className="pt-4 border-t border-[#E8DFC8] flex flex-col sm:flex-row items-center justify-between gap-3">
        <button
          type="button"
          onClick={onStartNew}
          className="w-full sm:w-auto px-4 py-2 rounded-lg border border-[#D5C9B5] text-xs font-medium text-[#55635C] hover:bg-[#F5EDE0] transition-colors"
        >
          Start New Protocol
        </button>

        <button
          type="button"
          onClick={onClinicianContinue}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#FAF8F5] border border-[#8C4A26] text-xs font-semibold text-[#8C4A26] hover:bg-[#F5EDE0] transition-colors shadow-2xs"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>I am designing a clinical protocol on this topic</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
