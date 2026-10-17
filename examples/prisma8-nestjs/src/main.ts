import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Prisma 8 DTO spike').setVersion('0.0.0').build());
    SwaggerModule.setup('docs', app, document);
    await app.listen(3000);
    console.log('Swagger UI: http://localhost:3000/docs');
}

void bootstrap();
