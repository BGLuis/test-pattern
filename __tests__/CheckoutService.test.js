import { jest } from '@jest/globals';
import { Item } from '../src/domain/Item.js';
import { Pedido } from '../src/domain/Pedido.js';
import { CheckoutService } from '../src/services/CheckoutService.js';
import { CarrinhoBuilder } from './builders/CarrinhoBuilder.js';
import { UserMother } from './builders/UserMother.js';

describe('CheckoutService', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('quando o pagamento falha', () => {
        it('deve retornar null quando o gateway recusar a cobrança (Stub)', async () => {
            // Arrange
            const carrinho = new CarrinhoBuilder().build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: false }),
            };
            const repositoryDummy = {};
            const emailDummy = {};
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryDummy,
                emailDummy
            );

            // Act
            const pedido = await checkoutService.processarPedido(
                carrinho,
                '1234-5678-9012-3456'
            );

            // Assert
            expect(pedido).toBeNull();
        });

        it('não deve chamar o PedidoRepository nem o EmailService quando o pagamento falhar (Mock)', async () => {
            // Arrange
            const carrinho = new CarrinhoBuilder().build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: false }),
            };
            const repositoryMock = { salvar: jest.fn() };
            const emailMock = { enviarEmail: jest.fn() };
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryMock,
                emailMock
            );

            // Act
            await checkoutService.processarPedido(carrinho, '1234-5678-9012-3456');

            // Assert
            expect(repositoryMock.salvar).not.toHaveBeenCalled();
            expect(emailMock.enviarEmail).not.toHaveBeenCalled();
        });
    });

    describe('quando um cliente padrão finaliza a compra', () => {
        it('deve cobrar o valor integral e retornar o pedido salvo com o totalFinal correto (Stub)', async () => {
            // Arrange
            const carrinho = new CarrinhoBuilder()
                .comItens([new Item('Mouse', 150), new Item('Teclado', 150)])
                .build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: true }),
            };
            const repositoryStub = {
                salvar: jest
                    .fn()
                    .mockImplementation(
                        async (pedido) =>
                            new Pedido(10, pedido.carrinho, pedido.totalFinal, pedido.status)
                    ),
            };
            const emailDummy = { enviarEmail: jest.fn().mockResolvedValue() };
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryStub,
                emailDummy
            );

            // Act
            const pedido = await checkoutService.processarPedido(
                carrinho,
                '1234-5678-9012-3456'
            );

            // Assert
            expect(pedido).not.toBeNull();
            expect(pedido.id).toBe(10);
            expect(pedido.totalFinal).toBe(300);
            expect(pedido.status).toBe('PROCESSADO');
            expect(gatewayStub.cobrar).toHaveBeenCalledWith(300, '1234-5678-9012-3456');
        });
    });

    describe('quando um cliente Premium finaliza a compra', () => {
        it('deve aplicar desconto de 10% na cobrança e enviar e-mail de aprovação (Stub + Mock)', async () => {
            // Arrange
            const usuarioPremium = UserMother.umUsuarioPremium();
            const carrinho = new CarrinhoBuilder()
                .comUser(usuarioPremium)
                .comItens([new Item('Suporte Notebook', 120), new Item('Headset', 80)])
                .build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: true }),
            };
            const repositoryStub = {
                salvar: jest
                    .fn()
                    .mockImplementation(
                        async (pedido) =>
                            new Pedido(1, pedido.carrinho, pedido.totalFinal, pedido.status)
                    ),
            };
            const emailMock = {
                enviarEmail: jest.fn().mockResolvedValue(),
            };
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryStub,
                emailMock
            );

            // Act
            const pedido = await checkoutService.processarPedido(
                carrinho,
                '9999-8888-7777-6666'
            );

            // Assert
            expect(gatewayStub.cobrar).toHaveBeenCalledTimes(1);
            expect(gatewayStub.cobrar).toHaveBeenCalledWith(180, '9999-8888-7777-6666');
            expect(emailMock.enviarEmail).toHaveBeenCalledTimes(1);
            expect(emailMock.enviarEmail).toHaveBeenCalledWith(
                'premium@email.com',
                'Seu Pedido foi Aprovado!',
                'Pedido 1 no valor de R$180'
            );
            expect(pedido.totalFinal).toBe(180);
            expect(pedido.status).toBe('PROCESSADO');
        });
    });

    describe('cenários de borda e resiliência', () => {
        it('deve retornar o pedido salvo mesmo quando o envio de e-mail falhar', async () => {
            // Arrange
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const carrinho = new CarrinhoBuilder().build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: true }),
            };
            const repositoryStub = {
                salvar: jest
                    .fn()
                    .mockImplementation(
                        async (pedido) =>
                            new Pedido(2, pedido.carrinho, pedido.totalFinal, pedido.status)
                    ),
            };
            const emailStub = {
                enviarEmail: jest.fn().mockRejectedValue(new Error('SMTP indisponível')),
            };
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryStub,
                emailStub
            );

            // Act
            const pedido = await checkoutService.processarPedido(
                carrinho,
                '1234-5678-9012-3456'
            );

            // Assert
            expect(pedido).not.toBeNull();
            expect(pedido.id).toBe(2);
            expect(pedido.totalFinal).toBe(100);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Falha ao enviar e-mail',
                'SMTP indisponível'
            );
        });

        it('deve processar um carrinho vazio cobrando valor zero', async () => {
            // Arrange
            const carrinho = new CarrinhoBuilder().vazio().build();
            const gatewayStub = {
                cobrar: jest.fn().mockResolvedValue({ success: true }),
            };
            const repositoryStub = {
                salvar: jest
                    .fn()
                    .mockImplementation(
                        async (pedido) =>
                            new Pedido(3, pedido.carrinho, pedido.totalFinal, pedido.status)
                    ),
            };
            const emailDummy = { enviarEmail: jest.fn().mockResolvedValue() };
            const checkoutService = new CheckoutService(
                gatewayStub,
                repositoryStub,
                emailDummy
            );

            // Act
            const pedido = await checkoutService.processarPedido(
                carrinho,
                '1234-5678-9012-3456'
            );

            // Assert
            expect(gatewayStub.cobrar).toHaveBeenCalledWith(0, '1234-5678-9012-3456');
            expect(pedido.totalFinal).toBe(0);
        });
    });
});
