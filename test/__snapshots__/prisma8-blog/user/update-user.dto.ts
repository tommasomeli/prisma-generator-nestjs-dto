import { Role } from '../enums';
import { Post } from '../post';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsInt, IsOptional, IsString, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateUserDto {
	@ApiProperty({ type: 'number', required: true, format: 'int32' })
	@IsNotEmpty()
	@IsInt()
	 id!: number;

	@ApiProperty({ type: 'string', required: false })
	@IsOptional()
	@IsNotEmpty()
	@IsString()
	 email?: string;

	@ApiProperty({ type: 'string', required: false })
	@IsOptional()
	@IsNotEmpty()
	@IsString()
	 name?: string;

	@ApiProperty({ enum: Role, enumName: 'Role', required: false, default: 'USER' })
	@IsOptional()
	@IsNotEmpty()
	 role?: Role = Role.USER;

	@ApiProperty({ type: 'string', required: false, nullable: true })
	@IsOptional()
	@IsString()
	 bio?: string | null;

	@ApiProperty({ type: () => Post, isArray: true, required: false, nullable: true })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => Post)
	 posts?: Post[] | null;

	@ApiProperty({ type: () => Date, required: false, format: 'date-time' })
	@IsOptional()
	@IsNotEmpty()
	@IsDateString()
	 createdAt?: Date;
}