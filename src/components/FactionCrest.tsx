import React from 'react';
import { FactionId } from '../game/types';

interface FactionCrestProps {
  faction: FactionId;
  size?: number;
  className?: string;
}

export const FactionCrest: React.FC<FactionCrestProps> = ({
  faction,
  size = 56,
  className = '',
}) => {
  if (faction === 'majapahit') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M10 10H54V32C54 46 32 56 32 56C32 56 10 46 10 32V10Z"
          fill="#1E3A8A"
          stroke="#F59E0B"
          strokeWidth="2.5"
        />
        <circle cx="32" cy="27" r="9" fill="#F59E0B" />
        {/* Surya Majapahit rays */}
        <path
          d="M32 13V16M32 38V41M18 27H21M43 27H46M22 17L24.5 19.5M39.5 34.5L42 37M42 17L39.5 19.5M24.5 34.5L22 37"
          stroke="#FDE68A"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M32 21L35 28L32 45L29 28L32 21Z" fill="#1E293B" stroke="#FEF3C7" strokeWidth="1.2" />
      </svg>
    );
  }

  if (faction === 'byzantium') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        className={className}
        aria-hidden="true"
      >
        <path
          d="M10 10H54V32C54 46 32 56 32 56C32 56 10 46 10 32V10Z"
          fill="#7F1D1D"
          stroke="#F59E0B"
          strokeWidth="2.5"
        />
        {/* Fortress Battlement Tower */}
        <path
          d="M21 43V25H25V21H29V25H35V21H39V25H43V43H21Z"
          fill="#E2E8F0"
          stroke="#0F172A"
          strokeWidth="1.5"
        />
        <rect x="29" y="33" width="6" height="10" fill="#450A0A" />
        <path d="M18 43H46" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 10H54V32C54 46 32 56 32 56C32 56 10 46 10 32V10Z"
        fill="#064E3B"
        stroke="#F59E0B"
        strokeWidth="2.5"
      />
      {/* Crescent & Crossed Cannon/Sabers */}
      <path
        d="M36 18C29.5 18 24.5 23 24.5 29.5C24.5 36 29.5 41 36 41C32.5 39.5 30 35 30 29.5C30 24 32.5 19.5 36 18Z"
        fill="#FBBF24"
      />
      <polygon points="39,26 40.5,29 44,29.5 41.5,31.5 42,35 39,33 36,35 36.5,31.5 34,29.5 37.5,29" fill="#FDE68A" />
      <path d="M20 44L44 20M44 44L20 20" stroke="#CBD5E1" strokeWidth="1.6" strokeOpacity="0.45" />
    </svg>
  );
};
