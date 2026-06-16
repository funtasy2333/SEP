import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 单个目次目标（客户端从渲染后 print HTML 的目次节点提取）。 */
export class TocTargetDto {
  @IsString()
  @MaxLength(256)
  target!: string;

  @IsString()
  @MaxLength(2048)
  text!: string;

  @IsIn(['front', 'body'])
  division!: 'front' | 'body';
}

/** POST /api/convert/html-to-pdf 请求体。 */
export class HtmlToPdfDto {
  /** print 变体 HTML（已内联 printCss） */
  @IsString()
  @MaxLength(20 * 1024 * 1024)
  html!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TocTargetDto)
  toc!: TocTargetDto[];

  /** 正文首页文件名称（定位正文起始页） */
  @IsString()
  @IsOptional()
  @MaxLength(512)
  docTitle?: string;

  /** 下载文件名（不含扩展名） */
  @IsString()
  @IsOptional()
  @MaxLength(256)
  filename?: string;
}
