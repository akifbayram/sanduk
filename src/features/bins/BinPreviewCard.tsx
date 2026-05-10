import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/badge';
import { getPhotoThumbUrl } from '@/features/photos/usePhotos';
import { useTagStyle } from '@/features/tags/useTagStyle';
import { getCardRenderProps, parseCardStyle } from '@/lib/cardStyle';
import { resolveIcon } from '@/lib/iconMap';
import { getPremadeUrl } from '@/lib/premadeBackgrounds';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function BinPreviewCard({ name, color, items, tags, icon, cardStyle, areaName, className, fixedSize }: {
  name: string;
  color: string;
  items: string[];
  tags: string[];
  icon?: string;
  cardStyle?: string;
  areaName?: string;
  className?: string;
  fixedSize?: boolean;
}) {
  const { theme } = useTheme();
  const getTagStyle = useTagStyle();
  const renderProps = getCardRenderProps(color, cardStyle ?? '', theme);
  const parsed = parseCardStyle(cardStyle ?? '');
  const isPhoto = renderProps.isPhotoVariant;
  const coverPhotoId = parsed?.coverPhotoId;
  const coverAssetId = parsed?.coverAssetId;
  const coverImageSrc = coverAssetId
    ? getPremadeUrl(coverAssetId)
    : coverPhotoId
      ? getPhotoThumbUrl(coverPhotoId)
      : undefined;
  const { mutedColor, primaryColor } = renderProps;
  const BinIcon = resolveIcon(icon ?? '');

  const secondaryStyle: CSSProperties | undefined = isPhoto
    ? { color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }
    : mutedColor ? { color: mutedColor } : undefined;
  const iconStyle: CSSProperties | undefined = isPhoto
    ? { color: 'rgba(255,255,255,0.9)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }
    : mutedColor ? { color: mutedColor } : undefined;
  const nameStyle: CSSProperties | undefined = isPhoto && coverImageSrc
    ? { color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }
    : primaryColor ? { color: primaryColor } : undefined;

  const showArea = fixedSize || !!areaName;
  const showItems = fixedSize || items.length > 0;
  const showTags = fixedSize || tags.length > 0;
  const tagsToRender = tags.length > 0 ? tags : fixedSize ? ['tag', 'label'] : [];

  const content = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-[15px] text-[var(--text-primary)] truncate leading-snug" style={nameStyle}>
          {name || <span>My bin</span>}
        </h3>
        {showArea && (
          <p className="text-[12px] text-[var(--text-tertiary)] truncate leading-relaxed" style={secondaryStyle}>
            {areaName || (fixedSize ? 'Area' : ' ')}
          </p>
        )}
        {showItems && (
          <p className="mt-1 text-[13px] text-[var(--text-tertiary)] line-clamp-1 leading-relaxed" style={secondaryStyle}>
            {items.length > 0 ? items.join(', ') : fixedSize ? 'Item one, item two, item three' : ' '}
          </p>
        )}
        {showTags && (
          <div className="flex gap-1.5 mt-2 overflow-hidden">
            {tagsToRender.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px]" style={getTagStyle(tag)}>
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <BinIcon className="mt-0.5 h-[22px] w-[22px] shrink-0 text-[var(--text-tertiary)]" style={iconStyle} />
    </div>
  );

  return (
    <div
      className={cn('max-w-[280px] w-full mx-auto relative overflow-hidden rounded-[var(--radius-lg)] px-4 py-3 text-left min-h-[72px] transition-[background-color,box-shadow] duration-200', renderProps.className, className)}
      style={renderProps.style}
    >
      {isPhoto && coverImageSrc ? (
        <>
          <img
            src={coverImageSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 photo-scrim" />
          <div className="relative z-10">{content}</div>
        </>
      ) : (
        content
      )}
      {renderProps.stripeBar && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            background: renderProps.stripeBar.color,
            ...(renderProps.stripeBar.position === 'left' && { left: 0, top: 0, bottom: 0, width: renderProps.stripeBar.width }),
            ...(renderProps.stripeBar.position === 'right' && { right: 0, top: 0, bottom: 0, width: renderProps.stripeBar.width }),
            ...(renderProps.stripeBar.position === 'top' && { left: 0, top: 0, right: 0, height: renderProps.stripeBar.width }),
            ...(renderProps.stripeBar.position === 'bottom' && { left: 0, bottom: 0, right: 0, height: renderProps.stripeBar.width }),
          }}
        />
      )}
    </div>
  );
}
