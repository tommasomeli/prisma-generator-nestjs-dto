import { Role } from '../enums';
import { Post } from '../post';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUserDto {
	@ApiProperty({ type: 'string', required: true })
	@IsNotEmpty()
	@IsString()
	 email!: string;

	@ApiProperty({ type: 'string', required: true })
	@IsNotEmpty()
	@IsString()
	 name!: string;

	@ApiProperty({ enum: Role, enumName: 'Role', required: true, default: 'USER' })
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

	@ApiProperty({ type: () => Date, required: true, format: 'date-time' })
	@IsNotEmpty()
	@IsDateString()
	 createdAt!: Date;
}