import type { JsonValue } from '@prisma/orm-framework/utils/json';
import { User } from '../user';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, IsOptional, IsObject, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePostDto {
	@ApiProperty({ type: 'string', required: true })
	@IsNotEmpty()
	@IsString()
	@MaxLength(120)
	 title!: string;

	@ApiProperty({ type: 'string', required: true })
	@IsNotEmpty()
	@IsString()
	 body!: string;

	@ApiProperty({ type: 'string', required: true, format: 'decimal' })
	@IsNotEmpty()
	 score!: string;

	@ApiProperty({ type: () => Object, required: false, nullable: true })
	@IsOptional()
	@IsObject()
	 meta?: JsonValue | null;

	@ApiProperty({ type: () => User, required: true })
	@IsNotEmpty()
	@ValidateNested()
	@Type(() => User)
	 author!: User;

	@ApiProperty({ type: () => Date, required: true, format: 'date-time' })
	@IsNotEmpty()
	@IsDateString()
	 createdAt!: Date;
}