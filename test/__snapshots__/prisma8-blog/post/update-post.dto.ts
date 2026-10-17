import type { JsonValue } from '@prisma/orm-framework/utils/json';
import { User } from '../user';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsInt, IsOptional, IsString, MaxLength, IsObject, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePostDto {
	@ApiProperty({ type: 'number', required: true, format: 'int32' })
	@IsNotEmpty()
	@IsInt()
	 id!: number;

	@ApiProperty({ type: 'string', required: false })
	@IsOptional()
	@IsNotEmpty()
	@IsString()
	@MaxLength(120)
	 title?: string;

	@ApiProperty({ type: 'string', required: false })
	@IsOptional()
	@IsNotEmpty()
	@IsString()
	 body?: string;

	@ApiProperty({ type: 'string', required: false, format: 'decimal' })
	@IsOptional()
	@IsNotEmpty()
	 score?: string;

	@ApiProperty({ type: () => Object, required: false, nullable: true })
	@IsOptional()
	@IsObject()
	 meta?: JsonValue | null;

	@ApiProperty({ type: () => User, required: false })
	@IsOptional()
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => User)
	 author?: User;

	@ApiProperty({ type: () => Date, required: false, format: 'date-time' })
	@IsOptional()
	@IsNotEmpty()
	@IsDateString()
	 createdAt?: Date;
}