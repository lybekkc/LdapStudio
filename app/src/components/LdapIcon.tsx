import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export const LdapIcon: React.FC<IconProps> = ({ size = 24, ...props }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Definerer gradienten for en moderne glød */}
      <defs>
        <linearGradient id="ldap-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" /> {/* Sky blue */}
          <stop offset="100%" stopColor="#6366f1" /> {/* Indigo */}
        </linearGradient>
      </defs>

      {/* LDAP Rot-node (Toppen av treet) */}
      <circle cx="12" cy="5" r="2" fill="url(#ldap-gradient)" stroke="url(#ldap-gradient)" />

      {/* Forgreininger/Linjer nedover */}
      <path d="M12 7v4" />
      <path d="M12 11H6v3" />
      <path d="M12 11h6v3" />

      {/* Venstre sub-node (F.eks. OU / Organisasjonsenhet) */}
      <circle cx="6" cy="16" r="2" />

      {/* Høyre sub-node som blir omsluttet av "klient-søkeprosessen" */}
      {/* Selve linsen i forstørrelsesglasset fungerer som noden her */}
      <circle cx="18" cy="16" r="3" fill="url(#ldap-gradient)" fillOpacity="0.1" stroke="url(#ldap-gradient)" />

      {/* Håndtaket til forstørrelsesglasset (Klienten som spør) */}
      <path d="M20.2 18.2l1.8 1.8" stroke="url(#ldap-gradient)" strokeWidth="2" />
    </svg>
  );
};

